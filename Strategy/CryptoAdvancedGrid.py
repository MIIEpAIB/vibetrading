import ccxt
import numpy as np
import pandas as pd
import time

class CryptoAdvancedGrid:
    def __init__(self, config):
        """
        数字货币专用网格策略初始化
        """
        # 1. 交易所 API 配置 (支持各大数字货币交易所，此处以币安现货为例)
        self.exchange = ccxt.binance({
            'apiKey': config['api_key'],
            'secret': config['secret_key'],
            'enableRateLimit': True,  # 必须开启，防止请求过频被交易所封 IP
            'options': {'defaultType': 'spot'}  # spot为现货，future为U本位合约
        })
        
        self.symbol = config.get('symbol', 'BTC/USDT')
        self.total_grid_capital = config.get('grid_capital', 1000.0) # 分配给该网格的总U金额
        self.grid_count = config.get('grid_count', 10)
        self.use_trend_filter = config.get('use_trend_filter', True)
        
        # 运行时内部状态
        self.buy_grids = []
        self.sell_grids = []
        self.active_orders = {} # 在本地内存中记录影子订单状态 {价格: 订单类型}
        
        # 2. 自动加载交易所市场规则（获取精度要求）
        self.exchange.load_markets()
        self.market = self.exchange.market(self.symbol)
        
    def fetch_historical_data(self):
        """
        从交易所获取 K 线数据计算指标
        """
        try:
            # 获取最近 200 根 1小时 K 线
            ohlcv = self.exchange.fetch_ohlcv(self.symbol, timeframe='1h', limit=250)
            df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            return df
        except Exception as e:
            print(f"❌ 获取行情数据失败: {e}")
            return None

    def calculate_indicators(self, df):
        """
        计算数字货币量化指标 (EMA + ATR)
        """
        # 计算 200周期 EMA (趋势过滤)
        df['ema_200'] = df['close'].ewm(span=200, adjust=False).mean()
        
        # 计算 ATR (真实波幅自适应格子间距)
        high_low = df['high'] - df['low']
        high_close = np.abs(df['high'] - df['close'].shift())
        low_close = np.abs(df['low'] - df['close'].shift())
        ranges = pd.concat([high_low, high_close, low_close], axis=1)
        df['atr'] = np.max(ranges, axis=1).rolling(14).mean()
        return df

    def update_crypto_grid_levels(self, current_price, current_atr):
        """
        ⚡️ 核心修改：数字货币专用等比自适应网格生成
        根据 ATR 动态调整单格百分比间距
        """
        # 将 ATR 转化为百分比波动率作为网格间距基准（例如当前波动率为 1.5%）
        grid_step_percent = (current_atr / current_price) * 0.5
        # 防止极端行情下格子过密或过稀疏，设置安全边界（0.5% - 3.0%）
        grid_step_percent = max(min(grid_step_percent, 0.03), 0.005)
        
        # 动态铺设等比网格 (Geometric Grid)
        self.buy_grids = [current_price * ((1 - grid_step_percent) ** i) for i in range(1, self.grid_count + 1)]
        self.sell_grids = [current_price * ((1 + grid_step_percent) ** i) for i in range(1, self.grid_count + 1)]
        
        # 利用交易所精度规则规范化价格（防止下单因为小数点位数报错）
        self.buy_grids = [float(self.exchange.price_to_precision(self.symbol, p)) for p in self.buy_grids]
        self.sell_grids = [float(self.exchange.price_to_precision(self.symbol, p)) for p in self.sell_grids]
        
        self.active_orders.clear()
        for p in self.buy_grids: self.active_orders[p] = 'BUY'
        for p in self.sell_grids: self.active_orders[p] = 'SELL'
        
        print(f"🔄 网格重置完成。当前间距比例: {grid_step_percent*100:.2f}%")
        print(f"📈 卖出止盈档位: {self.sell_grids}")
        print(f"📉 买入抄底档位: {self.buy_grids}")

    def execute_crypto_order(self, order_type, price, amount):
        """
        ⚡️ 核心修改：对接真实的数字货币 API 实盘下单
        """
        # 利用交易所精度规则规范化下单数量 (防止精度超标被拒)
        formatted_amount = float(self.exchange.amount_to_precision(self.symbol, amount))
        formatted_price = float(self.exchange.price_to_precision(self.symbol, price))
        
        # 验证最小下单名义价值（如现货通常要求大于 5USDT 或 10USDT）
        notional_value = formatted_amount * formatted_price
        if notional_value < self.market['limits']['cost']['min']:
            print(f"⚠️ 下单失败: 订单金额 {notional_value}U 低于交易所规定的单笔最小金额 {self.market['limits']['cost']['min']}U")
            return False

        try:
            if order_type == 'BUY':
                print(f"🛒 发送现货【限价买单】-> 价格: {formatted_price}, 数量: {formatted_amount}")
                order = self.exchange.create_limit_buy_order(self.symbol, formatted_amount, formatted_price)
                return order
            elif order_type == 'SELL':
                print(f"💰 发送现货【限价卖单】-> 价格: {formatted_price}, 数量: {formatted_amount}")
                order = self.exchange.create_limit_sell_order(self.symbol, formatted_amount, formatted_price)
                return order
        except Exception as e:
            print(f"❌ 交易所下单 API 发生异常: {e}")
            return False

    def run_loop(self):
        """
        主循环逻辑 (生产环境建议每 10-30 秒轮询一次)
        """
        print(f" ⏳ 正在扫描 {self.symbol} 市场行情...")
        df_raw = self.fetch_historical_data()
        if df_raw is None: return
        
        df = self.calculate_indicators(df_raw)
        latest_bar = df.iloc[-1]
        
        # 获取当前最新币价
        ticker = self.exchange.fetch_ticker(self.symbol)
        current_price = ticker['close']
        
        current_ema = latest_bar['ema_200']
        current_atr = latest_bar['atr']
        
        # 检查是否需要初始化或价格跑出网格边界进行重置
        if not self.buy_grids or current_price > max(self.sell_grids) or current_price < min(self.buy_grids):
            self.update_crypto_grid_levels(current_price, current_atr)
            return

        is_uptrend = current_price > current_ema

        # 检查是否跨入买入网格
        for buy_p in list(self.buy_grids):
            if current_price <= buy_p and self.active_orders.get(buy_p) == 'BUY':
                if self.use_trend_filter and not is_uptrend:
                    print(f"🛑 过滤拦截：币价处于 EMA200 ({current_ema:.2f}) 下方，属于单边熊市熊抬头，拒绝买入挂单：{buy_p}")
                    continue
                
                # 计算本档位应该投入的 U 金额 (马丁加仓：越低买得略微越多)
                grid_index = self.buy_grids.index(buy_p)
                martingale_factor = 1.0 + (grid_index * 0.05) # 每深一层多买 5%
                u_amount = (self.total_grid_capital / self.grid_count) * martingale_factor
                coin_amount = u_amount / buy_p
                
                res = self.execute_crypto_order('BUY', buy_p, coin_amount)
                if res:
                    self.active_orders[buy_p] = 'FILLED_BUY'
                    # 自动解锁当前档位对应的上一档作为“卖出止盈点位”
                    target_sell_p = self.sell_grids[grid_index]
                    self.active_orders[target_sell_p] = 'SELL'

        # 检查是否跨入卖出网格
        for sell_p in list(self.sell_grids):
            if current_price >= sell_p and self.active_orders.get(sell_p) == 'SELL':
                grid_index = self.sell_grids.index(sell_p)
                
                # 对应的买入数量
                u_amount = (self.total_grid_capital / self.grid_count)
                coin_amount = u_amount / sell_p
                
                res = self.execute_crypto_order('SELL', sell_p, coin_amount)
                if res:
                    self.active_orders[sell_p] = 'FILLED_SELL'
                    # 重新将下方对应格子的买入逻辑激活
                    target_buy_p = self.buy_grids[grid_index]
                    self.active_orders[target_buy_p] = 'BUY'

# --- 实例化并运行实盘（测试时可先用交易所的 Demo/Testnet 账户） ---
if __name__ == '__main__':
    crypto_config = {
        'api_key': '你的交易所API_KEY',
        'secret_key': '你的交易所SECRET_KEY',
        'symbol': 'BTC/USDT',         # 要运行的交易对
        'grid_capital': 500.0,       # 预分配 500 USDT 跑网格
        'grid_count': 6,             # 单侧网格层数
        'use_trend_filter': True     # 开启趋势过滤，牛市震荡才买，熊市观望
    }
    
    bot = CryptoAdvancedGrid(crypto_config)
    
    # 在生产中用 while True 让它持续运行
    while True:
        try:
            bot.run_loop()
            time.sleep(15)  # 数字货币现货可以每 15 秒轮询一次
        except Exception as e:
            print(f"⚠️ 循环发生不可预期错误: {e}")
            time.sleep(30)
