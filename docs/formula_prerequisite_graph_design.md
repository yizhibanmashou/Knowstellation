# 公式先修关系图功能设计

## 1. 背景与目的

当前项目已经从整本书中抽取出公式，并形成结构化公式库。新的目标是在此基础上构建一个面向学习者的公式先修关系图，使用户在阅读某个公式时，能够直观看到理解该公式所需要的直接前置公式和变量定义。

该功能不是为了展示复杂的全书级知识图谱，而是为了支持人的阅读和学习。因此它应当满足以下目标：

1. 对任意一个公式，展示其所有直接相关的 prerequisite 公式。
2. 每次点击只展开一层，不自动递归展开全部上游依赖。
3. 展示结果要直观、清晰、美观，避免大规模节点同时铺开。
4. 公式依赖应当基于变量定义与使用关系，而不是简单公式文本相似度。
5. 对没有来源公式的变量，也要展示变量定义，但这类节点不可继续点击。
6. 公式追溯暂时限制在当前章节内，避免图规模过大，并降低同符号多义造成的噪声。

核心用户体验可以概括为：

```text
点击公式 F
  -> 展示 F 的所有直接 prerequisite 公式
  -> 同时展示 F 中没有 prerequisite 公式来源的变量定义
  -> 不继续自动展开这些 prerequisite

点击某个 prerequisite 公式 G
  -> 展示 G 的所有直接 prerequisite 公式和变量定义
  -> 仍然只展开一层
```

## 2. 核心概念

### 2.1 Formula Node

Formula Node 表示一个可点击的公式节点。

建议字段：

```json
{
  "id": "chapter6_formula_012",
  "type": "formula",
  "chapter_id": "chapter6",
  "section_id": "6.2",
  "latex": "\\sigma^2 = E[(X-\\mu)^2]",
  "display_label": "Formula 6.12",
  "context_text": "Definition of variance",
  "source_chunk_id": "chapter6_012_block_03",
  "page": 123,
  "clickable": true
}
```

Formula Node 可以被点击。点击后，前端请求或读取该公式的一跳 prerequisite 列表。

### 2.2 Variable Definition Node

Variable Definition Node 表示“变量定义”节点。这类节点不是公式，不可继续展开，只用于解释当前公式中出现但没有前置公式来源的变量。

建议字段：

```json
{
  "id": "chapter6_formula_012_var_X",
  "type": "variable_definition",
  "chapter_id": "chapter6",
  "symbol": "X",
  "definition": "random variable",
  "source": "nearby_text",
  "source_chunk_id": "chapter6_011_block_02",
  "clickable": false
}
```

例如当前公式为：

```latex
L = \sum_i (y_i - \hat{y}_i)^2
```

如果 `\hat{y}_i` 来自某个前置公式，而 `y_i`、`x_i`、`i` 只是文本中定义的样本、标签和索引，则展示方式应当是：

```text
Prerequisite formulas:
  - \hat{y}_i = f(x_i)

Variable definitions:
  - y_i: the true label of the i-th sample
  - x_i: the i-th input sample
  - i: sample index
```

其中 `\hat{y}_i = f(x_i)` 是可点击公式节点，变量定义节点不可点击。

### 2.3 Symbol Sense

不能把同一个字母符号当成全书唯一变量。很多符号在不同位置可能有不同含义，例如 `\sigma` 可能表示标准差，也可能表示应力；`\alpha` 可能表示学习率，也可能表示显著性水平。

因此建议在内部引入 Symbol Sense，即“某个符号在某个上下文中的含义”。

实现时不要把哈希表设计成 `symbol -> single definition`。更合适的结构是：

```text
symbol -> [sense_id_1, sense_id_2, ...]
sense_id -> sense detail
```

也就是说，同一个符号可以挂多个 sense。系统每次读取到一个新变量时，先根据符号查到候选 sense 列表，再判断新定义应该合并到已有 sense，还是创建一个新的 sense。

示例：

```json
{
  "sense_id": "chapter6_sigma_001",
  "symbol": "\\sigma",
  "normalized_symbol": "\\sigma",
  "meaning": "standard deviation",
  "scope": {
    "chapter_id": "chapter6",
    "section_id": "6.2",
    "start_position": 8,
    "end_position": 21
  },
  "defined_by": {
    "type": "formula",
    "id": "chapter6_formula_010"
  },
  "definition_sources": [
    {
      "type": "formula",
      "id": "chapter6_formula_010"
    }
  ],
  "examples": [
    "\\sigma^2 = E[(X-\\mu)^2]"
  ],
  "confidence": 0.88
}
```

公式依赖不应简单建立在字符串匹配上，而应尽量建立在：

```text
当前公式使用 symbol
  -> 在当前章节和当前位置解析出最可能的 symbol sense
  -> 找到该 symbol sense 的定义来源
  -> 如果定义来源是公式，则形成 prerequisite formula
  -> 如果定义来源是文本，则形成 variable definition node
```

## 3. 依赖关系定义

### 3.1 直接 prerequisite

对公式 F 来说，直接 prerequisite 是指：

1. F 中使用了某个符号或变量 v。
2. 在 F 之前的本章节内容中，存在定义、引入或计算 v 的公式 G。
3. G 对理解 F 中的 v 有直接帮助。

则 G 是 F 的直接 prerequisite。

注意：

- 只追溯当前章节内的公式。
- 只考虑当前公式之前出现的定义来源。
- 不跨章节寻找 prerequisite。
- 不自动展开 G 的 prerequisite，除非用户点击 G。
- 对当前公式的所有直接 prerequisite 都应展示，不做 Top-K 截断。

### 3.2 变量定义节点

如果公式 F 中的变量 v 没有找到合适的前置公式，但在附近文本、当前小节、当前章节中有文字定义，则应展示为 Variable Definition Node。

这类节点用于解释变量含义，但不可点击。

常见情况包括：

- 输入变量：`x_i`
- 标签变量：`y_i`
- 索引变量：`i, j, k`
- 参数：`n, m, d`
- 集合或样本空间：`D, S, \Omega`
- 文本中定义但没有单独公式定义的概念符号

### 3.3 边的方向

数据层建议采用：

```text
prerequisite -> dependent formula
```

也就是前置公式指向依赖它的公式。

前端交互中，用户点击当前公式 F 时，展示的是 F 的上游：

```text
incoming prerequisites of F
```

边上应显示触发依赖的变量，例如：

```json
{
  "from": "chapter6_formula_010",
  "to": "chapter6_formula_012",
  "via_symbol": "\\mu",
  "relation": "defines_symbol",
  "reason": "nearest previous definition in the same section",
  "confidence": 0.91
}
```

## 4. 数据结构建议

### 4.1 公式依赖索引

可以为每个章节生成一个公式依赖索引文件，例如：

```text
formula_dependency/chapter6_formula_dependencies.json
```

建议结构：

```json
{
  "chapter_id": "chapter6",
  "version": 1,
  "formulas": [
    {
      "id": "chapter6_formula_012",
      "latex": "\\sigma^2 = E[(X-\\mu)^2]",
      "section_id": "6.2",
      "position": 12,
      "symbols_used": ["\\sigma", "E", "X", "\\mu"],
      "symbols_defined": ["\\sigma^2"]
    }
  ],
  "symbol_index": {
    "\\sigma": [
      "chapter6_sigma_001",
      "chapter6_sigma_002"
    ],
    "\\mu": [
      "chapter6_mu_001"
    ]
  },
  "senses": {
    "chapter6_sigma_001": {
      "symbol": "\\sigma",
      "normalized_symbol": "\\sigma",
      "meaning": "standard deviation",
      "scope": {
        "chapter_id": "chapter6",
        "section_id": "6.2",
        "start_position": 8,
        "end_position": 21
      },
      "defined_by": {
        "type": "formula",
        "id": "chapter6_formula_010"
      },
      "definition_sources": [
        {
          "type": "formula",
          "id": "chapter6_formula_010"
        }
      ],
      "examples": [
        "\\sigma^2 = E[(X-\\mu)^2]"
      ],
      "confidence": 0.88
    },
    "chapter6_sigma_002": {
      "symbol": "\\sigma",
      "normalized_symbol": "\\sigma",
      "meaning": "stress",
      "scope": {
        "chapter_id": "chapter6",
        "section_id": "6.5",
        "start_position": 39,
        "end_position": 45
      },
      "defined_by": {
        "type": "formula",
        "id": "chapter6_formula_041"
      },
      "definition_sources": [
        {
          "type": "formula",
          "id": "chapter6_formula_041"
        }
      ],
      "examples": [
        "\\sigma = F / A"
      ],
      "confidence": 0.84
    }
  },
  "dependencies": [
    {
      "dependent_formula_id": "chapter6_formula_012",
      "items": [
        {
          "type": "formula",
          "target_formula_id": "chapter6_formula_009",
          "via_symbol": "\\mu",
          "relation": "defines_symbol",
          "reason": "same section, nearest previous formula defining \\mu",
          "confidence": 0.9
        },
        {
          "type": "variable_definition",
          "symbol": "X",
          "definition": "random variable",
          "source": "nearby_text",
          "source_chunk_id": "chapter6_011_block_02",
          "confidence": 0.72
        }
      ]
    }
  ],
  "ambiguous_symbols": [
    {
      "formula_id": "chapter6_formula_020",
      "symbol": "\\alpha",
      "candidates": [
        {
          "type": "formula",
          "target_formula_id": "chapter6_formula_004",
          "meaning": "significance level",
          "confidence": 0.55
        },
        {
          "type": "variable_definition",
          "definition": "learning rate",
          "source_chunk_id": "chapter6_018_block_01",
          "confidence": 0.52
        }
      ]
    }
  ]
}
```

### 4.2 依赖项类型

每个 dependent formula 的 prerequisite item 至少分两类：

1. `formula`
   - 可点击。
   - 指向另一个公式节点。
   - 用于展示前置公式。

2. `variable_definition`
   - 不可点击。
   - 展示变量符号和文字定义。
   - 用于解释没有前置公式来源的变量。

后续如果需要，可以再扩展出：

- `concept_definition`
- `table_reference`
- `ambiguous_candidate`

但第一版建议先保持简单。

## 5. 构建流程建议

### 5.1 输入

优先使用已经生成的结构化数据：

```text
data/structured/*.json
formula_library.json
table_library.json
chunk/block text
section/chapter/page metadata
```

如果当前公式库字段不足，可能需要从结构化 JSON 中补充：

- 公式 LaTeX。
- 公式所属 chapter/section/subsection。
- 公式在章节中的顺序位置。
- 公式附近正文文本。
- 公式所在 chunk/block。

### 5.2 处理步骤

建议第一版 pipeline：

```text
1. 读取章节内全部公式和上下文文本
2. 为每个公式抽取 symbols_used 和 symbols_defined
3. 从公式附近文本中抽取变量定义候选
4. 在章节内按公式位置从前往后扫描
5. 建立 symbol sense registry
6. 对每个公式的每个 used symbol 查找最近的上游 symbol sense
7. 如果 matched sense 的定义来源是公式，生成 formula prerequisite item
8. 如果 matched sense 的定义来源是文本，生成 variable_definition item
9. 对当前公式中新定义的 symbols_defined 更新章节级 Symbol Sense 哈希表
10. 如果 symbol 不存在，创建新 symbol key 和新 sense
11. 如果 symbol 已存在，比较新定义与已有 senses 的语义相似度和上下文
12. 高置信匹配则合并到已有 sense，明显不同则创建新 sense_id
13. 对多个候选且难以判定的符号，输出 ambiguous_symbols
14. 生成每章 dependency index
```

处理顺序上，建议对单个公式先解析 `symbols_used`，再把 `symbols_defined` 写入或合并到 Symbol Sense 哈希表。这样可以避免当前公式刚定义的左侧变量被误认为当前公式自身的 prerequisite。

### 5.3 符号抽取建议

第一版可以用规则抽取，不必追求完全数学语义解析。

需要处理的常见符号形式包括：

- 单字母变量：`x`, `y`, `n`
- 希腊字母：`\alpha`, `\beta`, `\mu`, `\sigma`
- 带上下标变量：`x_i`, `y_{ij}`, `\theta_t`
- 带帽/横线/波浪线变量：`\hat{y}`, `\bar{x}`, `\tilde{x}`
- 粗体或向量：`\mathbf{x}`, `\boldsymbol{\theta}`
- 函数或算子：`E`, `P`, `Var`, `Cov`

注意要过滤明显不是变量的 LaTeX 命令，例如：

```text
\frac, \sum, \int, \left, \right, \sqrt, \log, \exp
```

`E`, `P`, `Var`, `Cov` 这类数学算子的处理规则已经确认：如果教材中存在公式定义，则作为可追溯的公式对象；如果没有对应公式定义，则作为不可点击的变量/算子定义节点展示。

## 6. 同符号多义问题处理

同一个字母或符号在不同位置可能表示不同含义，这是该功能的主要难点之一。

建议策略：

### 6.1 限制作用域

第一版只在当前章节内追溯 prerequisite，避免全书范围内同符号冲突。

### 6.2 按局部上下文优先级解析

查找某个符号定义时，优先级建议为：

```text
当前公式附近文本
-> 当前 subsection 前文
-> 当前 section 前文
-> 当前 chapter 前文
```

### 6.3 只使用上游定义

后文定义不能作为前文公式的 prerequisite。

### 6.4 最近定义优先

当同一符号在本章前文多次被定义，默认使用距离当前公式最近的定义。

但如果最近定义与当前公式上下文明显不一致，应降低置信度，或者标为 ambiguous。

### 6.5 保存置信度和原因

每条依赖边都建议保存：

- `via_symbol`
- `reason`
- `confidence`
- `source`

这样前端或审核工具可以展示“为什么连这条边”，也方便人工修正。

### 6.6 歧义不要强行合并

如果同一符号有多个候选定义，且系统无法可靠判断，应输出 ambiguous candidate，而不是强行选择一个。

前端可以暂时展示为“可能相关”，或在审核模式中让人工确认。

### 6.7 章节级 Symbol Sense 哈希表

为了减少同符号多义造成的混淆，建议为每个章节建立一个 Symbol Sense 哈希表。这个哈希表的第一层 key 是规范化后的符号，value 是该符号对应的 sense 列表。

这比 `symbol -> single definition` 更稳妥，因为同一个章节内也可能出现同符号不同含义。遇到同符号但语义不同的情况，不应强行复用同一个 key-value，而应在同一个 symbol key 下创建新的 `sense_id`。

推荐结构：

```json
{
  "chapter_id": "chapter6",
  "symbol_index": {
    "\\sigma": [
      "chapter6_sigma_001",
      "chapter6_sigma_002"
    ],
    "\\mu": [
      "chapter6_mu_001"
    ]
  },
  "senses": {
    "chapter6_sigma_001": {
      "symbol": "\\sigma",
      "normalized_symbol": "\\sigma",
      "meaning": "standard deviation",
      "scope": {
        "chapter_id": "chapter6",
        "section_id": "6.2",
        "start_position": 8,
        "end_position": 21
      },
      "defined_by": {
        "type": "formula",
        "id": "chapter6_formula_010"
      },
      "definition_sources": [
        {
          "type": "formula",
          "id": "chapter6_formula_010"
        }
      ],
      "examples": [
        "\\sigma^2 = E[(X-\\mu)^2]"
      ],
      "confidence": 0.88
    },
    "chapter6_sigma_002": {
      "symbol": "\\sigma",
      "normalized_symbol": "\\sigma",
      "meaning": "stress",
      "scope": {
        "chapter_id": "chapter6",
        "section_id": "6.5",
        "start_position": 39,
        "end_position": 45
      },
      "defined_by": {
        "type": "formula",
        "id": "chapter6_formula_041"
      },
      "definition_sources": [
        {
          "type": "formula",
          "id": "chapter6_formula_041"
        }
      ],
      "examples": [
        "\\sigma = F / A"
      ],
      "confidence": 0.84
    }
  }
}
```

每次读取到一个新变量或新定义时，处理流程如下：

```text
抽取新符号 v
-> 标准化为 normalized_symbol
-> 查询 symbol_index[normalized_symbol]
-> 如果不存在，创建新 symbol key 和第一个 sense
-> 如果存在，取出该 symbol 下所有已有 senses
-> 比较新定义与每个已有 sense 的语义相似度、上下文位置和作用域
-> 高置信匹配则合并到已有 sense
-> 明显不同则创建新的 sense_id，并挂到同一个 symbol key 下
-> 无法判断则标为 ambiguous，等待人工确认
```

合并时不要覆盖旧定义，而应追加证据：

```text
sense.definition_sources += new_source
sense.examples += current_formula_latex
sense.scope.end_position = current_position
sense.confidence = updated_confidence
```

语义相似度不应是唯一判断依据。建议综合以下信号：

- definition text similarity
- 当前公式与已有 sense 的 section/subsection 是否一致
- 位置距离
- 是否都由公式定义，还是一个由文本定义一个由公式定义
- 当前公式附近文本与已有 sense 上下文是否相似
- 是否存在人工 override

第一版可以使用三档阈值：

```text
similarity >= 0.85: 自动合并到已有 sense
similarity <= 0.55: 创建新的 sense_id
0.55 < similarity < 0.85: 标为 ambiguous，交给人工确认
```

阈值需要通过 review app 中的实际样例调试，不应视为固定常数。

查询时可以先从当前公式位置出发，在章节级哈希表中按以下顺序查找：

```text
同一 subsection 且位置在当前公式之前的 sense
-> 同一 section 且位置在当前公式之前的 sense
-> 同一 chapter 且位置在当前公式之前的 sense
```

如果多个候选同时命中，则根据位置距离、scope 近远、上下文相似度和人工 override 决定；仍无法判断时输出 ambiguous。

章节级 Symbol Sense 哈希表的作用是：

1. 统一记录每个符号在本章内可能存在的多个含义、作用域和定义来源。
2. 避免每次构建依赖边时重复解析同一个符号。
3. 为人工 override 提供稳定落点。
4. 让前端能解释“为什么这个符号被解析成这个含义”。

## 7. 前端展示建议

### 7.1 交互规则

核心交互规则：

1. 点击一个公式节点。
2. 展开该公式的所有直接 prerequisite formula nodes。
3. 展开该公式的所有 variable definition nodes。
4. 不自动继续展开 prerequisite formula nodes。
5. 用户点击某个 prerequisite formula node 后，再展开它自己的一跳 prerequisite。
6. Variable Definition Node 不可点击。

### 7.2 视觉区分

建议用不同样式区分节点类型：

- 当前公式节点：突出显示，居中或高亮。
- Prerequisite Formula Node：可点击公式卡片，有展开指示。
- Variable Definition Node：较小的信息卡片，不可点击，样式更轻。
- Ambiguous Candidate：用弱提示样式，标明“可能相关”。

边上建议显示变量名，例如：

```text
via \mu
via \hat{y}_i
via Var(X)
```

### 7.3 展示布局

推荐布局不是全局大图，而是局部展开视图：

```text
                    [Prerequisite formula A]
                         via \mu

[Variable: X] ----> [Current formula F] <---- [Prerequisite formula B]
                         via E

                    [Variable: i]
```

或者用列表与小图结合：

```text
Current formula
  \sigma^2 = E[(X-\mu)^2]

Prerequisite formulas
  \mu = E[X]              via \mu
  E[g(X)] = ...           via E

Variable definitions
  X: random variable
```

对学习场景来说，建议优先保证公式、变量解释和边标签清楚，而不是追求图形复杂度。

## 8. 需要注意的点

1. 不要做全书级全局展开。
   第一版只做章节内追溯，且每次只展开一跳。

2. 不要用简单“包含相同字母”建立公式依赖。
   这会产生大量错误边。必须结合位置、上下文和定义来源。

3. 不要对直接 prerequisite 做 Top-K 截断。
   对当前公式而言，只要是直接相关的 prerequisite，都应展示。

4. 不要让变量定义节点可点击。
   变量定义节点只解释变量含义，不继续展开。

5. 同符号多义要保留证据。
   边上要保存 reason 和 confidence，歧义情况要显式输出。

6. 不要用 `symbol -> single definition` 覆盖旧值。
   同一个 symbol key 下应允许多个 sense_id。语义相同则合并证据，语义不同则新建 sense，无法判断则标为 ambiguous。

7. 不要把所有 LaTeX 命令都当成变量。
   需要维护 stoplist 和 operator list。

8. 公式上下文很重要。
   前端不要只展示 LaTeX，最好同时展示公式编号、章节位置和一句上下文说明。

9. 第一版应优先可解释。
   如果自动判断不确定，宁可标为 ambiguous，也不要生成看似确定但错误的依赖。

## 9. Use Cases

### Use Case 1: 方差公式追溯

当前公式：

```latex
\sigma^2 = E[(X-\mu)^2]
```

用户点击该公式后，系统展示：

```text
Prerequisite formulas:
  - \mu = E[X]                 via \mu
  - E[g(X)] = \sum_x g(x)p(x)  via E

Variable definitions:
  - X: random variable
```

用户如果点击 `\mu = E[X]`，系统才继续展示 `\mu = E[X]` 的直接 prerequisite，例如：

```text
Prerequisite formulas:
  - E[X] = \sum_x x p(x)       via E

Variable definitions:
  - X: random variable
```

### Use Case 2: 机器学习损失函数

当前公式：

```latex
L = \sum_i (y_i - \hat{y}_i)^2
```

系统识别：

- `\hat{y}_i` 由前置公式定义。
- `y_i`、`x_i`、`i` 是文本中定义的样本标签、输入和索引。

点击后展示：

```text
Prerequisite formulas:
  - \hat{y}_i = f_\theta(x_i)  via \hat{y}_i

Variable definitions:
  - y_i: true label of the i-th sample
  - x_i: input of the i-th sample
  - i: sample index
```

其中 `\hat{y}_i = f_\theta(x_i)` 可点击，变量定义不可点击。

### Use Case 3: 同符号多义

同一章中，`\alpha` 在前文两个位置出现：

```text
Section 6.1: \alpha is the significance level.
Section 6.4: \alpha is the learning rate.
```

当前公式位于 Section 6.4：

```latex
\theta_{t+1} = \theta_t - \alpha \nabla L(\theta_t)
```

系统应优先选择 Section 6.4 附近定义的 `\alpha`，而不是 Section 6.1 的定义。

输出可能为：

```text
Variable definitions:
  - \alpha: learning rate
```

如果系统无法判断两个候选哪个更合理，则输出 ambiguous：

```text
Ambiguous:
  - \alpha may refer to significance level in Section 6.1
  - \alpha may refer to learning rate in Section 6.4
```

### Use Case 4: 只有变量定义，没有前置公式

当前公式：

```latex
p(x) = P(X = x)
```

如果本章前文没有公式定义 `X` 或 `x`，但附近文本写明 `X` is a discrete random variable and `x` is one possible value of `X`，则点击后展示：

```text
Variable definitions:
  - X: discrete random variable
  - x: possible value of X
```

此时没有 prerequisite formula，但仍然能帮助学习者理解公式。

### Use Case 5: 递归但逐层展开

用户点击公式 F：

```text
F
  prerequisites: A, B
  variables: x, y
```

系统只展示 A、B、x、y。

如果用户点击 A：

```text
A
  prerequisites: C
  variables: z
```

系统再展示 C 和 z，但不会自动展示 C 的 prerequisite。只有用户继续点击 C，才展开下一层。

