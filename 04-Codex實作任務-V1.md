# 浮生錄 0.5.0 Codex 實作任務 V1

你正在修改專案：

- Repository：honey991127/fushenglu
- 目標版本：0.5.0
- 執行環境：iPhone TauriTavern／相容 SillyTavern 純前端 extension
- Node.js 只可用於開發、測試與建置
- Runtime 不得依賴 Node API

本次任務不是局部 hotfix，也不是只修改 AI prompt。
請依照下列階段順序實作，每完成一階段先執行測試，再進入下一階段。

不要跳過階段。
不要建立一次性 fix-fushenglu、run-fix、run-verify 類修補腳本。
不要手工維護兩套核心 runtime。
不要在驗證失敗時繼續堆疊新修補。

---

## 一、已確認的產品規則

### 1. 玩家

- 每個聊天只有一個玩家實體：`entity:player`。
- 同一聊天只使用同一 Persona。
- 玩家本名、化名、身份與稱號都合併到同一玩家。
- `role=user` 一定代表玩家。
- assistant 敘述可作為玩家狀態證據，但必須明確描述玩家。
- NPC 的狀態、位置、物品不得覆蓋玩家狀態。

### 2. 目前時間

- 普通介面只顯示一個最新主線時間。
- 舊時間不展示、不交接、不要求玩家確認。
- 舊時間只可在內部保留最少來源資料，用於撤銷與重建。
- 回憶、引用、夢境、傳聞、假設與未來計劃不得覆蓋目前時間。
- 「未時末至申時初」等時間範圍，以已到達的終點作目前時間。
- 日期與相鄰訊息中的時辰應合併。
- 「是夜」「翌日」「三日後」有可靠錨點時自動解析；沒有錨點才 pending。
- 明確時間推進不因跨度大而 pending。

### 3. 目前地點

- 只顯示玩家目前所在地。
- NPC 移動不得改變玩家所在地。
- 「你隨墨錚進入書房」更新玩家地點。
- 「墨錚獨自回到書房」只更新墨錚位置。
- 回憶、夢境、假設和計劃中的地點不得覆蓋目前地點。

### 4. 人物狀態

人物狀態分為：

- 持續狀態：受傷、中毒、婚約、官職、敵對、被囚禁等，直到明確解除。
- 即時狀態：驚訝、平靜、生氣、正在笑等，只保留最新值。

同一人物不得因不同稱呼、地點或情緒重複建立人物卡。

### 5. 關係

- 可以記錄明確正式關係。
- 可以記錄有清楚證據的自然語言趨勢，如「關係轉暖」「戒心降低」。
- 不得生成好感度 +5、信任值 72 等虛構數字。
- 一次普通禮貌、微笑或倒茶不足以建立關係變化。

### 6. 物品所有權

以下情況，收件人明確是玩家時，自動判定為安全取得：

- 對方交給玩家，玩家接過
- 玩家收下、拿到、拾得、買下、獲得
- 玩家收入袖中、行囊或儲物空間
- 原文明確表示歸玩家所有

以下情況不得進玩家行囊：

- 只是提到、看到、查看或閱讀
- 位於商店、庫房、桌面、房間或檔案
- 屬於 NPC 或其他人物
- 將來打算取得
- 回憶、夢境、假設或否定中的物品
- owner 缺失且無法由證據補出

所有權至少區分：

- owned
- gifted
- purchased
- borrowed
- temporary
- custody
- stored
- unknown

`borrowed`、`temporary`、`custody` 不得當成永久 owned。

### 7. 數量

- AI 可以理解數量文字，但不得猜數字。
- 「三枚」可保存 exact=3、unit=枚。
- 「一壺兩杯」「一袋」「一些」「幾張」保存原文 quantity.text。
- 缺少精確數量不得自動補成 1。
- 只有文法明確為單件時才可記 1。
- 模糊數量本身不 pending。
- 後續需要精確扣減而無法計算時才 pending。

### 8. 容器

物品按容器／存放地保存，例如：

- 袖中
- 行囊
- 儲物空間
- 房間箱子

首頁可顯示簡單總表，但交接必須區分：

- 隨身攜帶
- 存放在其他地方

### 9. 取得後立即消耗

例如：

> 墨錚遞來一杯酒，她接過後飲盡。

結果：

- 可建立 acquire 與 consume 兩個事件。
- 最終行囊沒有酒。
- 不 pending。
- 不交接酒。
- 兩個 eventId 不得碰撞。

### 10. 待確認

採用平衡模式。

只有以下情況 pending：

- 身份不明
- 所有權不明
- 後續數量運算無法計算
- 同一故事順序存在互相排斥的內容
- 否定、反諷、傳聞、假設無法可靠判斷
- 正式寫入所需關鍵值缺失

以下不得 pending：

- 明確時間推進
- 明確取得物品
- 明確使用或消耗
- 舊狀態被新狀態取代
- 已確認過的相同事實
- 只是格式不同
- 模型標 uncertain，但本地規則可以確定
- 單純出現人物或地點

### 11. 每輪確認

- 預設每輪只按一次「確認本輪」。
- 安全變化顯示摘要數量。
- 真正歧義另放待確認。
- 設定中可選「每輪總確認」或「安全項目自動提交」。
- 預設為每輪總確認。

### 12. 交接

交接只能從 committed character snapshot 生成，不能直接使用 proposal 或 handoff draft。

交接包含：

- 唯一目前時間
- 唯一玩家目前地點
- 玩家目前隨身物品
- 玩家存放於其他位置的關鍵物品
- 玩家目前貨幣
- 已確認人物持續狀態
- 已確認關係

交接排除：

- pending
- rejected
- superseded
- 舊時間與舊地點
- NPC／場景物品
- 已消耗或失去的物品
- add 1 等內部操作字樣

持續期限：

- 時間、地點、行囊：until_changed
- 人物持續狀態：直到解除
- 一次性提示：next_generation

### 13. 世界規則書

每個聊天獨立保存，可包含：

- 玩家稱號
- 人物別名
- 特殊曆法
- 時辰規則
- 貨幣名稱與層級
- 儲物空間
- 特殊單位
- 專有詞

AI 只能提出 suggested rule。
只有玩家確認後的 confirmed rule 可以影響正式解析。

通用核心不得硬編碼：

- 靈石
- 靈石不分品級
- 特定世界曆法
- 特定角色稱號

### 14. 重置

新增「重置此聊天的浮生錄資料」。

清除：

- batches
- events
- pendingItems
- character snapshot
- entities／relationships
- handoffItems
- history import progress

保留：

- API URL
- API Key
- 模型設定
- 插件全局設定

世界規則書讓使用者選擇保留或一併清除。

---

# 二、實作階段

## Phase 0：建立安全分支與基準

1. 從目前預設分支建立：
   `codex/fushenglu-0.5.0`
2. 執行並保存基準結果：
   - `git status`
   - `npm run verify`
3. 不修改使用者聊天資料。
4. 不提交任何本機修補 zip、bat、mjs 或臨時 README。

完成後先回報基準，不要假設目前 runtime 與 source 一致。

---

## Phase 1：修正單一原始碼與建置架構

目前問題：

- tests 多數讀取未版本化 `.js`
- manifest 實際載入 `.v042.js`
- build 不會由 source 自動生成整套版本化 runtime
- 手機執行碼可能與測試碼分叉

要求：

1. 只保留一套可人工編輯的 source。
2. 不再人工維護 `.js` 與 `.v042.js` 兩套核心檔。
3. build 根據 manifest version 或 content hash 自動產生 cache-safe runtime。
4. manifest.js 必須由 build 自動更新到生成入口。
5. build config 必須由 manifest runtime dependency closure 自動產生或驗證。
6. tests 必須直接驗證 dist 中 manifest 真正載入的 runtime。
7. 所有生成 runtime 逐檔執行語法檢查。
8. runtime 不含：
   - `node:` import
   - `require(`
   - `process.env`
   - Node filesystem/path API
9. version module 仍由 manifest version 生成。
10. 移除對 `v042`、`0.4.2` 的建置硬編碼。
11. `npm run verify` fail 0 後才進 Phase 2。

建立獨立 commit：

`refactor: use one source and generated cache-safe runtime`

---

## Phase 2：資料模型 V5 與安全遷移

建立 ChatState V5。

至少包含：

- worldRules
- entities
- relationships
- current snapshot
- 唯一 historyImportProgress 格式
- pending decision records
- events ledger

要求：

1. 舊 V4 可安全遷移。
2. 未來未知版本仍停止覆寫。
3. 遷移不得把 owner 缺失的 inventory 默認為玩家。
4. 提供 `resetCurrentChatData()`：
   - 清除聊天分析資料
   - 保留 API settings
   - 可選保留 worldRules
5. 正式重置前 UI 顯示影響範圍並要求一次確認。
6. 事件軟刪除與 snapshot rebuild 保持可用。
7. 不在 migration 中偷偷猜測舊資料。
8. 不可靠的舊污染資料可標記 legacy/untrusted，重置後清除。
9. `npm run verify` fail 0 後才進 Phase 3。

建立 commit：

`refactor: add ChatState V5 and safe chat reset`

---

## Phase 3：固定 AI 資料契約與本地規則引擎

新增純前端核心模組，例如：

- `analysis-policy.js`
- `candidate-normalizer.js`
- `semantic-classifier.js`
- `fact-key.js`
- `snapshot-reducer.js`

名稱可依架構調整，但職責必須分離。

### 3.1 AI 候選

AI 只輸出候選，不決定最終 apply/pending。

共用欄位至少包含：

- kind
- operation
- subjectRef
- value
- timelineContext
- evidence.messageRef
- evidence.messageIndex
- evidence.quote
- evidenceOrder
- confidence
- modelUncertain

模型不得決定：

- eventId
- factKey
- 最終 disposition
- 玩家所有權的默認值

### 3.2 固定 schema

為每種 kind 建立固定 value schema：

- story_time
- place
- inventory
- currency
- person_state
- relationship
- wardrobe
- skill
- cultivation
- world_rule

不得再使用任意 JSON `value: {}` 作為唯一正式契約。

`timelineContext` 至少包括：

- main
- memory
- quote
- dream
- hypothetical
- hearsay
- plan
- unknown

### 3.3 本地分類

每個候選由 deterministic classifier 產生：

- apply
- discard
- pending
- suppress

模型的 uncertain 只能作參考。

### 3.4 factKey

factKey 必須由本地產生，並在以下流程一致使用：

- 合併
- 去重
- 抑制
- event
- snapshot
- handoff

模型 dedupeKey 不得作權威。

### 3.5 eventId

eventId 至少包含：

- messageRef
- messageIndex
- evidenceOrder
- kind
- operation
- subjectEntityId
- factKey

確保同一訊息內 acquire + consume 不碰撞。

`npm run verify` fail 0 後才進 Phase 4。

建立 commit：

`feat: add deterministic semantic policy engine`

---

## Phase 4：時間、身份與歷史分段合併

### 4.1 時間

建立全局時間 reducer：

1. 按 messageIndex／evidenceOrder 排序。
2. 合併相鄰日期與時辰。
3. 範圍使用終點作 currentTime。
4. main 只保留一個最新 currentTime。
5. 非 main 不覆蓋 currentTime。
6. 舊時間不生成 pending。
7. UI 不顯示 timelineHistory。
8. 只有真正互相排斥且無法排序才 pending。

### 4.2 地點

- 只有玩家 subject 才更新 currentPlace。
- NPC location 保存於人物實體。
- 非 main 不覆蓋 currentPlace。

### 4.3 身份與別名

- 每聊天只有 `entity:player`。
- confirmed world rule 可合併稱號。
- AI 可提出 alias 建議，但不能自動 confirmed。
- 同名或不同稱號不能只靠字串猜測合併。

### 4.4 歷史分段

1. 每段至少重疊 2 條訊息。
2. 傳入：
   - messageRef
   - messageIndex
   - role
   - speakerName
   - content
   - identityContext
   - rollingContext
3. rollingContext 至少包含：
   - current time anchor
   - player aliases
   - entity anchors
4. 所有 chunk 完成後才全局合併。
5. chunk 中間候選不得直接展示。
6. 只保留一套 historyImportProgress。
7. 恢復前驗證：
   - pipelineVersion
   - branchFingerprint
   - messageRefsHash
   - chunkBoundaries
8. 任一不一致則舊進度失效。
9. 同一批分析只允許一個 repair phase，避免重複 API 請求。
10. `npm run verify` fail 0 後才進 Phase 5。

建立 commit：

`feat: add rolling-context history consolidation`

---

## Phase 5：資產、數量、容器與關係 reducer

### 5.1 資產

資產至少包含：

- name
- ownerEntityId
- ownership
- container
- quantity
- current

owner 缺失不得默認玩家。

### 5.2 quantity

使用：

```json
{
  "exact": null,
  "unit": null,
  "text": "一壺兩杯",
  "isExact": false
}
```

不得補 1。

### 5.3 container

至少支援：

- carried
- inventory
- sleeve
- storage_space
- room
- other

同名物品是否合併，必須考慮：

- owner
- ownership
- container
- unit

### 5.4 關係

- formal status 與 trend 分開。
- trend 只保存自然語言／枚舉，不保存虛構數值。
- 普通禮貌不產生 relationship event。

### 5.5 快照

snapshot 只代表目前成立的狀態。

排除：

- pending
- rejected
- superseded
- memory／dream／hypothetical
- 已消耗資產
- NPC 資產誤作玩家資產

`npm run verify` fail 0 後才進 Phase 6。

建立 commit：

`feat: rebuild current character snapshot`

---

## Phase 6：重做普通介面

普通模式不得直接顯示 JSON。

### 6.1 首頁

只顯示：

- 目前時間
- 玩家目前地點
- 目前行囊／貨幣摘要
- 人物持續狀態摘要
- 真正待確認數量

不顯示舊時間列表。

### 6.2 本輪

安全變化以摘要呈現：

> 本輪辨識到 8 項安全變化  
> 時間 1、物品 2、人物狀態 3、其他 2

提供一次：

- 確認本輪
- 取消本輪

真正歧義不混入安全摘要。

### 6.3 待確認

主列表只顯示：

`status === "pending"`

accepted、rejected、edited、deferred、discarded 移到處理紀錄。

卡片顯示：

- 自然語言問題
- 證據摘要
- 有意義的選項

普通模式禁止：

- JSON textarea
- proposalId
- dedupeKey
- schemaVersion
- raw object

管理模式可在 `<details>` 中顯示技術資料。

### 6.4 世界規則書

提供：

- AI 建議列表
- 接受／拒絕
- 已確認規則列表
- 刪除或修改規則

### 6.5 重置

新增：

> 重置此聊天的浮生錄資料

顯示：

- 將清除哪些內容
- API 設定不受影響
- 是否保留世界規則

`npm run verify` fail 0 後才進 Phase 7。

建立 commit：

`feat: add human-readable review and reset UI`

---

## Phase 7：從快照生成交接

移除 proposal-based handoff draft 作為正式來源。

流程：

1. commit events
2. rebuild snapshot
3. compare previous and new snapshot
4. generate canonical handoff items
5. update extension prompt

要求：

- 同一 state dimension 只有一個目前交接。
- inventory 不以單張 add proposal 交接。
- 交接使用目前完整資產摘要。
- 新增物品不能把其他舊物品交接關掉。
- 已消耗、失去、pending、NPC 資產不交接。
- stored item 明確註明不在身上。
- 不顯示 add 1。

示例：

```text
[浮生錄一致性提示]
- 目前時間：大曆十二年三月廿一・申時初。
- 玩家目前在書房。
- 玩家隨身持有桂花糕（一盒）。
- 冬衣存放於房間箱子，不在玩家身上。
```

保留現有：

- next_generation 只有 assistant 回覆保存成功後才消耗
- regenerate／swipe 不消耗

`npm run verify` fail 0 後才進 Phase 8。

建立 commit：

`feat: generate handoff from committed snapshot`

---

## Phase 8：完整驗收與文件

建立端到端 fixture，從聊天文字或可控 AI 回應開始，至少覆蓋：

### 時間

- 三月十七亥時
- 三月十九卯時
- 三月十九日至三月二十日
- 三月廿一未時末至申時初
- 是夜
- 回憶中的舊日期
- 三日後的未來計劃

預期：

- currentTime 只有最新主線時間
- 舊時間不在普通 UI 或交接
- 不產生大量時間 pending

### 地點

- 玩家進入書房
- NPC 獨自回書房
- 回憶中的皇宮

### 身份

- 玩家本名＋郡主稱號
- 同一 NPC 多稱呼
- 不重複人物卡

### 物品

- 明確交付「溫桂花釀一壺兩杯」
- 只讓查看信紙
- 檔案提到他人手機
- 商店展示長劍
- 借用物品
- owner 缺失
- 一些糕點
- 一壺兩杯
- 取得後立即飲盡

### 容器

- 袖中
- 行囊
- 儲物空間
- 房間箱子

### 關係

- 正式任命
- 有證據的關係轉暖
- 普通倒茶不建立關係

### UI

- pending 主列表不顯示 accepted
- 普通模式不顯示 JSON
- 安全變化只需一次總確認
- 重置可清空 162 筆污染資料
- API settings 保留

### 歷史掃描

- 跨 chunk 日期＋時辰
- 跨 chunk 交付動作
- 跨 chunk 玩家稱號
- 分支／Swipe／編輯後進度失效
- 同一聊天重掃兩次不重複

### Build

- 只有一套 source
- dist runtime 由 build 生成
- manifest 實際入口被測試
- 所有 runtime 語法檢查
- runtime dependency closure 完整
- runtime 無 Node-only import
- 沒有硬編碼 v042／0.4.2

更新：

- README
- architecture 文件
- migration 說明
- 使用者重置說明

README 不得再寫：

- 第二階段
- ChatState V2
- manifest 0.2.0
- 尚未建立人物／物品／地點

版本：

- manifest.json：0.5.0
- package.json：0.5.0
- UI 顯示 v0.5.0
- 版本仍以 manifest 為單一來源

最終執行：

```text
npm run verify
```

必須：

- tests fail 0
- build 成功
- dist 完整
- git status 只包含正式檔案

建立最終 commit：

`release: fushenglu 0.5.0 semantic rules engine`

---

# 三、禁止事項

- 不要只擴充 prompt 而不建立本地規則引擎。
- 不要讓模型 uncertain 直接等於 pending。
- 不要讓 owner 缺失默認玩家。
- 不要缺少數量時補 1。
- 不要讓 proposal 直接生成正式交接。
- 不要人工維護 `.js` 與 `.v042.js` 兩份核心程式。
- 不要把世界觀硬編碼進通用核心。
- 不要在普通 UI 顯示 JSON。
- 不要在測試失敗時繼續下一 Phase。
- 不要提交臨時修補工具。
- 不要修改或刪除 API Key。
- 不要在未完成 migration 與 reset 前要求使用者重掃聊天。

---

# 四、每階段回報格式

每完成一個 Phase，回報：

1. 修改檔案
2. 架構變化
3. 新增測試
4. `npm run verify` 實際結果
5. git commit SHA
6. 仍未完成的 Phase
7. 是否有任何假設需要使用者決定

遇到規格不明時停止並提問，不要自行改變產品規則。

最終不要直接合併到 main。
先 push `codex/fushenglu-0.5.0`，回報 branch、commit SHA、verify 結果與實機測試步驟。
