## ADDED Requirements

### Requirement: 环境状态检测与复用
The system SHALL check the local environment status before running the application.

#### Scenario: 首次进入或环境未启动
- **WHEN** 执行启动脚本且检测到后端或前端端口未被占用
- **THEN** 系统应当执行完整的依赖安装与应用部署，拉起前后端服务。

#### Scenario: 重复使用 codex 或环境已运行
- **WHEN** 执行启动脚本且检测到端口已被正常占用
- **THEN** 系统应当跳过部署步骤，**SHALL NOT** 重新安装依赖或覆盖当前运行环境，直接复用当前环境。
