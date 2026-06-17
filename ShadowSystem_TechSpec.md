# 模拟交易系统（影子路由架构）技术需求文档 (Tech Spec)

## 1. 业务背景与设计原则 (Background & Principles)
本系统参考 eToro (e投睿) 的 "Virtual Portfolio" 影子系统模式设计。系统不采用完全独立的模拟盘服务器，而是通过“双轨路由”机制，将实盘与模拟盘整合在同一套后端生态中。

### 核心原则：
* **双轨路由，一核两表**：实盘与模拟盘共享前端 UI、API 网关和行情广播服务，仅在“资产账本”和“订单执行”层面进行路由隔离。
* **状态机复用**：通过统一的账户类型标签（`Account_Type`），复用所有的下单、撤单、持仓计算的业务流程逻辑。
* **高并发防刷**：在模拟盘高频吃单/高并发场景下，通过协程锁（或数据库排他锁）确保资产状态机的一致性，杜绝并发导致的资产变负或刷钱漏洞。

---

## 2. 核心数据模型 (Data Models)

系统采用统一的枚举和结构定义，使用 Python 的 `dataclasses` 进行内存模型抽象，底层可无缝映射至关系型数据库（PostgreSQL）。

### 2.1 核心枚举 (Enums)
* `AccountType`: `REAL` (实盘), `VIRTUAL` (影子模拟盘)
* `OrderSide`: `BUY` (买入), `SELL` (卖出)
* `OrderType`: `MARKET` (市价), `LIMIT` (限价)
* `OrderStatus`: `PENDING` (挂单中), `FILLED` (完全成交), `CANCELED` (已撤单)

### 2.2 核心实体结构 (Entities)
```python
from enum import Enum
from typing import Dict, Optional, List
from dataclasses import dataclass, field
import time
import asyncio

class AccountType(Enum):
    REAL = "REAL"
    VIRTUAL = "VIRTUAL"

class OrderSide(Enum):
    BUY = "BUY"
    SELL = "SELL"

class OrderType(Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"

class OrderStatus(Enum):
    PENDING = "PENDING"
    FILLED = "FILLED"
    CANCELED = "CANCELED"

@dataclass
class Wallet:
    user_id: str
    account_type: AccountType
    asset_name: str
    balance: float = 0.0
    frozen: float = 0.0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)  # 并发安全锁

@dataclass
class Order:
    order_id: str
    user_id: str
    account_type: AccountType
    symbol: str
    side: OrderSide
    type: OrderType
    price: float
    quantity: float
    status: OrderStatus = OrderStatus.PENDING
    executed_price: float = 0.0
    timestamp: float = field(default_factory=time.time)
```

---

## 3. 资产管理器核心逻辑 (Wallet Manager)

`WalletManager` 负责统一的资产扣减、冻结与清算结算。必须保证原子性。

```python
class WalletManager:
    """高并发安全的资产管理器"""
    def __init__(self):
        self._wallets: Dict[tuple, Wallet] = {}
        self._global_lock = asyncio.Lock()

    async def _get_or_create_wallet(self, user_id: str, account_type: AccountType, asset_name: str) -> Wallet:
        key = (user_id, account_type, asset_name)
        async with self._global_lock:
            if key not in self._wallets:
                # 默认给模拟盘账户初始化 100,000 虚拟清算资金
                initial_balance = 100000.0 if account_type == AccountType.VIRTUAL and asset_name in ["USD", "USDT"] else 0.0
                self._wallets[key] = Wallet(user_id, account_type, asset_name, balance=initial_balance)
            return self._wallets[key]

    async def freeze_funds(self, user_id: str, account_type: AccountType, asset_name: str, amount: float) -> bool:
        """下单时：冻结可用资产"""
        wallet = await self._get_or_create_wallet(user_id, account_type, asset_name)
        async with wallet.lock:
            if wallet.balance >= amount:
                wallet.balance -= amount
                wallet.frozen += amount
                return True
            return False

    async def unfreeze_funds(self, user_id: str, account_type: AccountType, asset_name: str, amount: float) -> bool:
        """撤单时：解冻资产"""
        wallet = await self._get_or_create_wallet(user_id, account_type, asset_name)
        async with wallet.lock:
            if wallet.frozen >= amount:
                wallet.frozen -= amount
                wallet.balance += amount
                return True
            return False

    async def execute_settlement(self, user_id: str, account_type: AccountType, 
                                 debit_asset: str, debit_amount: float, 
                                 credit_asset: str, credit_amount: float) -> bool:
        """成交时：双向资产清算"""
        deb_wallet = await self._get_or_create_wallet(user_id, account_type, debit_asset)
        cred_wallet = await self._get_or_create_wallet(user_id, account_type, credit_asset)
        
        async with deb_wallet.lock:
            async with cred_wallet.lock:
                if deb_wallet.frozen >= debit_amount:
                    deb_wallet.frozen -= debit_amount
                    cred_wallet.balance += credit_amount
                    return True
                return False
```

---

## 4. 影子模拟撮合引擎 (Virtual Matching Engine)

模拟撮合引擎**不维护**复杂的 Order Book 深度队列排队，而是作为**“行情监听执行器”**运行。它通过订阅真实行情的最新价格（Last Traded Price）直接对模拟订单做出成交反馈。

### 4.1 核心撮合规则
1. **市价单 (Market Order)**：
   * 触发时直接读取当前市场最新价 $P_{current}$。
   * 订单状态直接变更为 `FILLED`。
   * 平均成交价设为 $P_{current}$，调用 `WalletManager` 进行即时清算。
2. **限价单 (Limit Order)**：
   * 订单存入模拟挂单池（`limit_order_pool`）。
   * **异步监听真实行情更新**：
     * 若为 `BUY` 单：当市场最新价 $\le$ 订单委托价时，触发完全成交。
     * 若为 `SELL` 单：当市场最新价 $\ge$ 订单委托价时，触发完全成交。
   * 成交价格采用委托限价，并从挂单池中移除该订单。

```python
class VirtualMatchingEngine:
    """基于真实行情广播的影子撮合引擎"""
    def __init__(self, wallet_manager: WalletManager):
        self.wallet_manager = wallet_manager
        self.limit_order_pool: Dict[str, List[Order]] = {}

    async def get_market_price(self, symbol: str) -> float:
        """模拟获取当前真实市场价（实盘行情网关广播）"""
        return 65000.0 if "BTC" in symbol else 3500.0

    async def process_order(self, order: Order):
        if order.account_type != AccountType.VIRTUAL:
            return  # 影子引擎仅处理模拟盘订单

        if order.type == OrderType.MARKET:
            await self._match_market_order(order)
        elif order.type == OrderType.LIMIT:
            await self._register_limit_order(order)

    async def _match_market_order(self, order: Order):
        current_price = await self.get_market_price(order.symbol)
        order.executed_price = current_price
        order.status = OrderStatus.FILLED
        
        base_asset, quote_asset = order.symbol.split("_")
        
        if order.side == OrderSide.BUY:
            cost = order.quantity * current_price
            await self.wallet_manager.execute_settlement(
                user_id=order.user_id, account_type=order.account_type,
                debit_asset=quote_asset, debit_amount=cost,
                credit_asset=base_asset, credit_amount=order.quantity
            )
        else:
            revenue = order.quantity * current_price
            await self.wallet_manager.execute_settlement(
                user_id=order.user_id, account_type=order.account_type,
                debit_asset=base_asset, debit_amount=order.quantity,
                credit_asset=quote_asset, credit_amount=revenue
            )

    async def _register_limit_order(self, order: Order):
        if order.symbol not in self.limit_order_pool:
            self.limit_order_pool[order.symbol] = []
        self.limit_order_pool[order.symbol].append(order)

    async def on_market_price_update(self, symbol: str, new_price: float):
        """当外部真实行情更新时触发（外部事件驱动调用）"""
        if symbol not in self.limit_order_pool:
            return
        
        active_orders = self.limit_order_pool[symbol]
        remaining_orders = []
        base_asset, quote_asset = symbol.split("_")

        for order in active_orders:
            triggered = False
            if order.side == OrderSide.BUY and new_price <= order.price:
                triggered = True
            elif order.side == OrderSide.SELL and new_price >= order.price:
                triggered = True
            
            if triggered:
                order.executed_price = order.price
                order.status = OrderStatus.FILLED
                if order.side == OrderSide.BUY:
                    await self.wallet_manager.execute_settlement(
                        order.user_id, order.account_type,
                        debit_asset=quote_asset, debit_amount=order.quantity * order.price,
                        credit_asset=base_asset, credit_amount=order.quantity
                    )
                else:
                    await self.wallet_manager.execute_settlement(
                        order.user_id, order.account_type,
                        debit_asset=base_asset, debit_amount=order.quantity,
                        credit_asset=quote_asset, credit_amount=order.quantity * order.price
                    )
            else:
                remaining_orders.append(order)
        
        self.limit_order_pool[symbol] = remaining_orders
```

---

## 5. 异步流测试验证 (Verification)

```python
async def main():
    wm = WalletManager()
    engine = VirtualMatchingEngine(wm)
    user_id = "user_test_01"
    symbol = "BTC_USDT"
    
    # 1. 验证初始化资产
    init_wallet = await wm._get_or_create_wallet(user_id, AccountType.VIRTUAL, "USDT")
    print(f"💰 初始资产: {init_wallet.balance} {init_wallet.asset_name}")

    # 2. 验证市价单立即成交清算
    req_amount = 0.5 * 65000.0
    if await wm.freeze_funds(user_id, AccountType.VIRTUAL, "USDT", req_amount):
        market_order = Order("ORD001", user_id, AccountType.VIRTUAL, symbol, OrderSide.BUY, OrderType.MARKET, 0, 0.5)
        await engine.process_order(market_order)

    # 3. 验证限价单挂单与外部行情触集成交
    if await wm.freeze_funds(user_id, AccountType.VIRTUAL, "USDT", 1.0 * 60000.0):
        limit_order = Order("ORD002", user_id, AccountType.VIRTUAL, symbol, OrderSide.BUY, OrderType.LIMIT, 60000.0, 1.0)
        await engine.process_order(limit_order)
        
        # 模拟行情更新事件
        await engine.on_market_price_update(symbol, 59900.0)

if __name__ == "__main__":
    asyncio.run(main())
```
## 6。 提供一个前端入口