# 基于公式图构建概念图阶段进展

## 一、Concept 的来源与原书语言结构

当前 concept 是怎么找出来的。具体来源有三类：一是公式本身给出的定义符号，例如某个公式左侧定义的量；二是公式附近 structured blocks 中的原文解释；三是公式依赖图中已有前置公式定义出的概念。

原书中定义或引出概念常用的语言结构主要包括：`defined as` 直接定义；`let / letting ... denote` 先设定符号；`where ...` 解释公式中各符号；`is / are given by`、`becomes`、`yields` 在推导中给出新量；`called`、`denoted by` 给出名称；以及括号补充说明，例如 “the average number of descendants over categories (the mean fitness) is”。在 Chapter 6 中，系统能从 “Averaging over all categories, the mean trait value is” 抽出 Mean Trait Value，从 “Let \overline{z}_i denote the mean value...” 识别均值性状，从 “the response in trait value, R_z = ...” 识别 Response。每个 concept 都保留 source sentence 和 evidence，因此后续可以追溯到原书句子，而不是只看模型输出。

## 二、本轮完成内容

目前已实现概念图生成链路的第一版闭环。系统新增了 reviewable symbol-concept map，用 `chapter_id + formula_id + symbol + role -> concept` 表示符号语义，使同一符号在不同公式或上下文中可以对应不同概念。概念视图生成时，系统先找到当前概念的定义公式，再沿已有公式依赖追溯前置公式，并将前置公式定义出的概念转化为可点击的 prerequisite concepts；对于当前公式中首次引入、但没有可靠定义公式的概念，则作为不可点击的 introduced concepts 展示。

学习者端已经设计稿中的交互方向改造为“点击概念，展开一跳概念关系”。公式不再作为主要入口（搜索引擎我也优化一下现在可以支持概念搜索进入），而是作为概念解释的证据。
