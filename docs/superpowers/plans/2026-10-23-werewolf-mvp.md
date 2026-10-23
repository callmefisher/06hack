# 六人狼人杀 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付原生微信小程序、服务端权威六人对局、可用本地六客户端验证的房间闭环；真实微信语音未经账号与权限验证前明确阻止生产开局。

**Architecture:** Node.js HTTP + WebSocket 服务管理会话、房间、单调阶段时钟与状态转换。纯规则模块提供按玩家脱敏的快照和阶段语音权限；小程序只提交命令并展示自己的快照。额外提供只在显式开发模式开放的浏览器联调界面，用六个独立会话验证规则，不伪装真实语音。

**Tech Stack:** Node.js >=22、CommonJS JavaScript、ws 8、node:test、原生微信小程序 WXML/WXSS/JavaScript。前端与服务端共用公开展示模型，不下发规则引擎内部对象。

**Spec:** `.design/werewolf-product.html`（用户已于本次会话批准实施，包括未另行修改的默认建议）。

## Global Constraints

- 固定六人：2 狼人、1 预言家、3 村民；首夜只查验不袭击。
- 身份展示15秒，夜晚20秒，每人发言30秒，自由讨论60秒，投票15秒，加投10秒，遗言15秒。
- 出局不公开身份；终局或中止统一揭晓，私密查验永不公开给其他人。
- 先轮流发言，再自由讨论；投票隐藏选择、截止后公开票型；平票最多加投一次。
- 仅白天被放逐者在非终局时留遗言；旁观者不参与投票及狼人语音。
- 好人胜：无存活狼人；狼人胜：存活狼人数 >= 存活好人数。
- 六人各自准备后房主手动开始；下一局全员重新准备及重新洗牌。
- 存活玩家掉线触发每局共享30秒暂停；超时中止不判输赢；阶段剩余时间保留。
- 不记录语音、不强制手机号、不加入 LLM 或自动推理。
- 凭证仅放已忽略的 .env；生产身份由微信 code2session 获取，不信任客户端 playerId。
- 不提交或推送 Git，除非用户明确要求。保留现有已暂存设计文件和 claudesettings.json.bak。
- 实际微信登录、语音、域名与设备验证需要用户自己的账号配置；不声称已验证。

## Review Focus

- 伪造角色、越权查验、夜间窥探、投票未截止泄漏：引擎/快照测试验证全角色权限。
- 重复连接与旧连接关闭：房间服务测试保证旧连接不能驱逐新连接、恢复不重复耗时。
- 截止边界及暂停：恰好到期先结算，旧阶段命令和重放命令不得进入下一阶段。
- 非法 JSON、巨大消息、Unicode 昵称、满房与重进：协议层提供稳定错误且不泄露内部堆栈。
- 缺少微信凭证/语音适配、服务重启：明确失败或显示原房不可用，不能默默变成模拟生产模式。

---

## File Structure

- `server/game.js`: 权威对局、合法行动、计时、语音权限、玩家快照。
- `server/rooms.js`: 房间与成员、准备、房主、连接世代、离房与生命周期。
- `server/auth.js`: 微信 code 换取身份、短期内存会话、限流辅助。
- `server/index.js`: HTTP/WS、协议验证、心跳、定时广播、静态联调页面。
- `shared/presentation.js`: 小程序/联调界面共用阶段和角色中文说明，通过生成脚本复制到小程序。
- `miniprogram/`: 原生小程序，首页、房间页、API/语音适配与样式。
- `dev/`: 本地六标签联调入口，明确无真实语音。
- `tests/`: 引擎、房间、鉴权、协议集成测试及小程序控制器测试。
- `scripts/check.js`: 静态语法、配置与共享资源一致性检查。
- `README.md`, `.env.example`, `project.config.json`: 启动与导入说明。

### Task 1: 服务端规则引擎

**Files:** Create `server/game.js`, `tests/game.test.js`, `tests/helpers.js`, `package.json`.

**Interfaces:** `createGame(players, {now, roles?, firstSeat?}) -> Game`，`act(game, playerId, {type, targetId?, phaseId}, now) -> void`，`tick(game, now) -> boolean`，`setConnected(game, playerId, connected, now) -> void`，`snapshot(game, playerId, now) -> PlayerGameView`，`voicePolicy(game, playerId) -> {channel, canPublish, canListen}`。测试可注入身份/顺序，网络接口不能接受这些参数。

- [ ] 写首夜不袭击、查验私密、2/1/3身份、阶段时长、顺序/过麦、投票隐藏/加投/弃票/终局、狼人分歧、遗言、旁观越权、重连额度与阶段重放失败测试。
- [ ] Run `node --test tests/game.test.js`，先确认因缺少引擎失败。
- [ ] 实现可变但仅服务端持有的状态机，使用绝对时间截止；允许测试注入时钟与身份；快照显式白名单投影。
- [ ] Run 相同测试直到通过；添加恰好截止与多次暂停总计30秒的断言。

### Task 2: 好友房与会话边界

**Files:** Create `server/rooms.js`, `server/auth.js`, `tests/rooms.test.js`, `tests/auth.test.js`.

**Interfaces:** `RoomService({now, voiceAvailable, randomBytes})`，`create(user)`, `join(code,user)`, `attach(userId,connectionId)`, `detach(userId,connectionId)`, `command(userId, message)`, `view(userId)`, `tick()`；`AuthService({appId,appSecret,fetch,devMode,now})`，`login(body) -> {token,user}`, `authenticate(token) -> user`。

- [ ] RED: 满房、Unicode/空昵称、仅房主启动、语音未就绪不可准备、旧连接关闭、重进/重连、原房再开与 host 交接。
- [ ] GREEN: 内存房间与短期 bearer 会话；房号使用密码学随机数且校验冲突；微信身份依赖服务端 code2session；开发会话仅显式 DEV_MODE 启用。
- [ ] 测试错误网络、微信上游拒绝、过期会话和未经认证访问。
- [ ] Run `node --test tests/rooms.test.js tests/auth.test.js`。

### Task 3: HTTP/WS 实时联调服务

**Files:** Create `server/index.js`, `tests/server.test.js`, `.env.example`, `.gitignore`.

**Interfaces:** `createServer(config) -> {server, close, rooms}`；HTTP `POST /api/session`, `GET /health`; WS 首包 `{type:'authenticate',token}`，后续 `{requestId,type,...}`，响应 `{type:'ack',requestId}`、`{type:'state',room}`、`{type:'error',code,message,requestId}`。

- [ ] RED: 六客户端真实WS流程、未认证/畸形包/跨房行动、心跳断线、阶段命令与请求ID重放、生产禁用开发登录与静态联调。
- [ ] GREEN: ws 依赖、消息大小与频率上限、鉴权、认证超时、ping/pong、单服务计时器；不记录凭证/身份/查验。
- [ ] 定时推送脱敏快照（含 serverNow、phaseId、deadline）；客户端不推进阶段。
- [ ] Run `npm test`。

### Task 4: 原生小程序与明确的语音接入边界

**Files:** Create `miniprogram/app.*`, `miniprogram/pages/home/*`, `miniprogram/pages/room/*`, `miniprogram/services/{api,voice}.js`, `miniprogram/utils/presentation.js`, `shared/presentation.js`, `project.config.json`, `tests/client.test.js`.

**Interfaces:** `api.connect({onState,onError,onStatus})`, `api.send(command)`, `api.login()`；voice adapter `getStatus()`, `connect(policy)`, `disconnect()`。未配置真实提供商时返回 `available:false`，不得给生产 readiness 成功回执。开发模式仅有明确标记的联调 readiness，不调用录音API。

- [ ] RED: 提示/角色/候选动作映射、请求超时、重连后重新鉴权、身份过期、未知阶段失败关闭。
- [ ] GREEN: 首页创建/加入、邀请分享、好友房准备、身份提示、阶段行动、投票/加投/过麦/遗言、公开记录、结算重开、重连遮罩。
- [ ] 阶段变更清除选中目标；服务错误转为可读提示；全局身份始终仅展示本人的快照。
- [ ] 微信AppID留本地导入配置位；服务URL由已忽略配置文件提供，缺失时明确报错。
- [ ] Run `node --test tests/client.test.js` 与 `npm run check`。

### Task 5: 六客户端本地联调、验证与交接

**Files:** Create `dev/index.html`, `dev/client.js`, `dev/style.css`, `scripts/check.js`, `README.md`.

**Interfaces:** 浏览器入口消费 Task 3 完全相同协议；独立标签用 sessionStorage，各玩家独立身份；界面持续显示“开发联调，无真实语音”。

- [ ] 提供联调页面创建/加入真实房间、准备、对局动作、计时、可见性与结算；不提供客户端选择或修改角色的后门。
- [ ] 脚本检查全部JS语法、JSON配置、小程序页面完整性、复制资源一致性。
- [ ] 执行 `npm test`, `npm run check`；如本机浏览器工具可用，实际启动做一次界面走查；否则明确未验证。
- [ ] README 写明启动、六标签联调、小程序导入、微信登录配置、内存存储限制、语音未接通导致生产开局被阻止，以及发布前设备验证清单。
- [ ] 不 Git commit、不发布、不部署。交付时报告实际通过的测试和仍需账号/语音配置的阻塞。

## Self-review

每个已选玩法均由 Task 1/2 覆盖；Task 3 保证真实六客户端服务交互；Task 4/5 提供小程序源码及本地演示。此轮不把未验证语音包装成完整上线版。原设计允许语音平台验证成为门槛，因此提供 fail-closed adapter 并记录为剩余工作，不偷偷改成文字游戏。用户已明确要求进入实施，按 native 方式在当前会话继续，不再重复请求计划批准。
