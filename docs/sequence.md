
```
flowchart TD
    A["SKILL.md<br/>Flow Skill"] --> B["flow-parser.ts<br/>Markdown → FlowAst"]

    subgraph AST["1. Syntax Layer"]
        B --> C["FlowAst"]
        C --> C1["FlowAstFlow<br/>id / start / line"]
        C --> C2["FlowAstNode[]<br/>id / type / body / attrs / routes"]
        C2 --> C3["FlowAstRoute[]<br/>outcome / target / line"]
        C2 --> C4["FlowAstAttrs<br/>role / strategy / required / exclude / output / tools"]
    end

    C --> D["flow-validator.ts<br/>Semantic Validation"]

    subgraph VALIDATE["2. Semantic Validation"]
        D --> D1["Structural"]
        D1 --> D11["Exactly one @flow"]
        D1 --> D12["start exists"]
        D1 --> D13["Node IDs unique"]
        D1 --> D14["Route target exists"]
        D1 --> D15["Terminal has no route"]
        D1 --> D16["Non-terminal has route"]

        D --> D2["Outcome / Branch"]
        D2 --> D21["@agent: success + fail"]
        D2 --> D22["@action: success + fail"]
        D2 --> D23["@review: approve + reject"]
        D2 --> D24["@gate: registry outcomes complete"]

        D --> D3["Registry / Governance"]
        D3 --> D31["Gate registered"]
        D3 --> D32["Review registered"]
        D3 --> D33["Action registered"]
        D3 --> D34["Output contract registered"]
        D3 --> D35["Business Role valid"]
        D3 --> D36["Agent tools only narrow"]
        D3 --> D37["Review policy only narrow"]
    end

    D -->|valid| E["FlowDefinition<br/>Normalized + Executable Model"]
    D -->|invalid| X["Lint Errors<br/>line / node / code / message"]

    E --> F["flow-analyzer.ts<br/>Control-Flow Analysis"]

    subgraph ANALYZE["3. Logic Analysis"]
        F --> G["Build Graph<br/>nodes + routes"]
        G --> H["Reachability"]
        H --> H1["Every node reachable from start"]

        G --> I["Terminal Reachability"]
        I --> I1["Every reachable node<br/>can reach @end or @stop"]

        G --> J["Cycle / Loop Check"]
        J --> J1["Loops allowed"]
        J --> J2["Loop without terminal path → ERROR"]

        G --> K["Flow Completeness"]
        K --> K1["No dead branch"]
        K --> K2["No route to nowhere"]
        K --> K3["No executable path trapped forever"]
    end

    F -->|errors / warnings| X
    F -->|clean| L["Prepared Flow"]

    L --> M["WorkflowRunner"]

    subgraph RUNTIME["4. Runtime Execution"]
        M --> M1["@agent"]
        M --> M2["@gate"]
        M --> M3["@review"]
        M --> M4["@action"]
        M --> M5["@stop"]
        M --> M6["@end"]

        M1 --> N1["Copilot SDK / Agent Turn"]
        M2 --> N2["Registered deterministic Gate"]
        M3 --> N3["HumanTask + Approval Policy"]
        M4 --> N4["Action Policy → Approval → Executor"]
        M5 --> O["Failed / Rejected"]
        M6 --> P["Completed"]

        N1 --> Q1["success / fail"]
        N2 --> Q2["registered outcome"]
        N3 --> Q3["approve / reject"]
        N4 --> Q4["success / fail"]
    end

    Q1 --> M
    Q2 --> M
    Q3 --> M
    Q4 --> M

    M --> S["Durable Workflow State<br/>CAS workflow_version<br/>stepStatus"]
    S --> M

    style AST fill:#eef6ff,stroke:#4a90e2
    style VALIDATE fill:#f3f8ee,stroke:#6aa84f
    style ANALYZE fill:#fff7e6,stroke:#d6a84f
    style RUNTIME fill:#f7f0ff,stroke:#8e63ce

```