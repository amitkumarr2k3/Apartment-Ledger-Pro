# ETL Architecture Diagram

## System Overview

```mermaid
graph TB
    User["👤 User/Admin"]
    UI["🌐 Web UI<br/>Admin → ETL Integration"]
    API["🔌 API<br/>/api/admin/etl"]
    ETLService["⚙️ ETL Service<br/>backend/src/etl.ts"]
    Python["🐍 Python Script<br/>ETL/transform.py"]
    Config["📋 Mapping Config<br/>ETL/config/mapping.yaml"]
    InputDir["📁 Input Directory<br/>ETL/input/"]
    ProcDir["📁 Processed Directory<br/>ETL/processed/"]
    OutputDir["📁 Output Directory<br/>ETL/output/"]
    CSV["📄 Output CSV<br/>transactions.csv"]
    DB["🗄️ Database<br/>PostgreSQL"]
    
    User -->|Upload Files| UI
    UI -->|POST /upload| API
    API -->|Process| ETLService
    ETLService -->|Save Files| InputDir
    ETLService -->|Execute| Python
    Python -->|Read| Config
    Python -->|Read| InputDir
    Python -->|Write| OutputDir
    InputDir -->|Move| ProcDir
    OutputDir -->|Read| CSV
    CSV -->|Import| ETLService
    ETLService -->|Write| DB
    ETLService -->|Track| API
    API -->|Display| UI
    
    style User fill:#e1f5ff
    style UI fill:#f3e5f5
    style API fill:#e8f5e9
    style ETLService fill:#fff3e0
    style Python fill:#fce4ec
    style Config fill:#f1f8e9
    style InputDir fill:#ede7f6
    style ProcDir fill:#ede7f6
    style OutputDir fill:#ede7f6
    style CSV fill:#e0f2f1
    style DB fill:#ffebee
```

---

## Request Flow - File Upload

```mermaid
sequenceDiagram
    User->>UI: Click Upload, Select Files
    UI->>API: POST /admin/etl/upload (multipart)
    API->>ETLService: saveUploadedFiles(files)
    ETLService->>FileSystem: Write to ETL/input/
    ETLService->>API: Return input files list
    API->>ETLService: runETLTransformation(files)
    ETLService->>Python: spawn('python transform.py')
    Python->>Config: Load mapping.yaml
    Python->>InputDir: Read input files
    Python->>Python: Transform data
    Python->>OutputDir: Write transactions.csv
    Python->>FileSystem: Exit with code 0
    ETLService->>FileSystem: Move input to processed
    API->>CSV: readTransformedTransactions()
    CSV->>Database: Import transactions
    Database->>Database: SAVEPOINT per row
    API->>SessionDB: Record session
    API->>AuditLog: Log operation
    API->>UI: Return { success: true, stats }
    UI->>User: Show success message
```

---

## Processing Pipeline

```mermaid
graph LR
    A["📤 File Upload<br/>User Interface"] 
    B["💾 Save to Input<br/>ETL/input/"]
    C["⚙️ Transform<br/>Python Script"]
    D["📋 Generate Output<br/>transactions.csv"]
    E["🗂️ Archive Files<br/>ETL/processed/"]
    F["📥 Auto-Import<br/>Database"]
    G["✅ Complete<br/>Record Session"]
    
    A -->|Step 1| B
    B -->|Step 2| C
    C -->|Step 3| D
    C -->|Step 4| E
    D -->|Step 5| F
    F -->|Step 6| G
    
    style A fill:#c8e6c9
    style B fill:#bbdefb
    style C fill:#ffe0b2
    style D fill:#f8bbd0
    style E fill:#b3e5fc
    style F fill:#c5cae9
    style G fill:#d1c4e9
```

---

## Component Architecture

```mermaid
graph TB
    subgraph Frontend["🎨 Frontend"]
        Admin["Admin ETL Page<br/>src/routes/admin.etl.tsx"]
        Upload["Upload Component<br/>FileUploadZone"]
        History["History View<br/>Sessions List"]
    end
    
    subgraph Backend["⚙️ Backend"]
        Routes["ETL Routes<br/>admin.etl.ts"]
        Service["ETL Service<br/>etl.ts"]
        Parser["CSV Parser<br/>csv-parse"]
        Importer["Transaction Importer<br/>Reuses import logic"]
    end
    
    subgraph Processing["🔧 Processing"]
        Python["Python Transform<br/>transform.py"]
        Mapping["Mapping Config<br/>mapping.yaml"]
    end
    
    subgraph Storage["💾 Storage"]
        FSInput["Input Directory"]
        FSProcessed["Processed Directory"]
        FSOutput["Output Directory"]
    end
    
    subgraph Database["🗄️ Database"]
        ETLSession["etl_sessions Table"]
        ImportBatch["import_batches Table"]
        Staging["import_staging Table"]
        Transactions["transactions Table"]
        AuditLog["audit_log Table"]
    end
    
    Admin -->|Upload| Upload
    Upload -->|HTTP POST| Routes
    Routes -->|Process| Service
    Service -->|Save Files| FSInput
    Service -->|Execute| Python
    Mapping -->|Configure| Python
    Python -->|Output| FSOutput
    FSInput -->|Archive| FSProcessed
    FSOutput -->|Read| Parser
    Parser -->|Import| Importer
    Importer -->|Insert| Transactions
    Service -->|Track| ETLSession
    Routes -->|Record| ImportBatch
    Importer -->|Log Errors| Staging
    Routes -->|Audit| AuditLog
    Admin -->|View| History
    History -->|Query| ETLSession
    
    style Frontend fill:#e3f2fd
    style Backend fill:#f3e5f5
    style Processing fill:#fff3e0
    style Storage fill:#f1f8e9
    style Database fill:#ffebee
```

---

## Database Schema Relationships

```mermaid
erDiagram
    COMMUNITIES ||--o{ ETL_SESSIONS : "has"
    COMMUNITIES ||--o{ IMPORT_BATCHES : "has"
    COMMUNITIES ||--o{ TRANSACTIONS : "has"
    COMMUNITIES ||--o{ AUDIT_LOG : "has"
    
    USERS ||--o{ ETL_SESSIONS : "uploads"
    USERS ||--o{ IMPORT_BATCHES : "uploads"
    USERS ||--o{ AUDIT_LOG : "performs"
    
    IMPORT_BATCHES ||--o{ IMPORT_STAGING : "contains"
    
    HEADS ||--o{ CATEGORIES : "has"
    CATEGORIES ||--o{ TRANSACTIONS : "contains"
    CATEGORIES ||--o{ LINE_ITEMS : "has"
    
    VENDORS ||--o{ TRANSACTIONS : "supplied_by"
    VENDORS ||--o{ LINE_ITEMS : "supplied_by"
    
    FLATS ||--o{ TRANSACTIONS : "allocated_to"
    
    ETL_SESSIONS {
        uuid id PK
        uuid community_id FK
        string session_id
        uuid uploaded_by FK
        jsonb input_files
        jsonb output_files
        string status
        text error_message
        timestamp created_at
    }
    
    IMPORT_BATCHES {
        uuid id PK
        uuid community_id FK
        string filename
        string kind
        uuid uploaded_by FK
        int row_count
        string status
        timestamp created_at
    }
    
    IMPORT_STAGING {
        uuid id PK
        uuid batch_id FK
        int row_no
        jsonb raw_json
        text error
    }
    
    AUDIT_LOG {
        uuid id PK
        uuid community_id FK
        uuid actor_user_id FK
        string entity
        string action
        jsonb before
        jsonb after
        timestamp created_at
    }
```

---

## State Diagram - ETL Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Queued
    Queued --> Processing: Start ETL
    Processing --> Completed: Success
    Processing --> Failed: Error
    Processing --> Partial: Some rows fail
    
    Completed --> [*]
    Failed --> [*]
    Partial --> [*]
    
    note right of Queued
        Files received from UI
        Saved to input directory
    end note
    
    note right of Processing
        Python transform.py running
        Files being processed
        Importing to database
    end note
    
    note right of Completed
        All transactions imported
        Session recorded
        No errors
    end note
    
    note right of Failed
        Transform failed or
        All imports failed
        Check logs for details
    end note
    
    note right of Partial
        Some transactions imported
        Some rows had errors
        Check import_staging for errors
    end note
```

---

## Directory Structure - File Movement

```mermaid
graph TB
    subgraph ETL["ETL Directory"]
        subgraph Input["input/"]
            I1["expense_2025_01_15.csv"]
            I2["receipt_2025_01_15.xlsx"]
            I3["vendor_2025_01_15.csv"]
        end
        
        subgraph Process["processed/"]
            P1["expense_2025_01_15.csv"]
            P2["receipt_2025_01_15.xlsx"]
            P3["vendor_2025_01_15.csv"]
        end
        
        subgraph Output["output/"]
            O1["transactions.csv"]
            O2["transactions.xlsx"]
            O3["unmapped_items.csv"]
        end
        
        subgraph Config["config/"]
            C1["mapping.yaml"]
        end
    end
    
    User["👤 User"] -->|Upload| I1
    User -->|Upload| I2
    User -->|Upload| I3
    
    I1 -->|Move| P1
    I2 -->|Move| P2
    I3 -->|Move| P3
    
    O1 -->|Read| Import["📥 Import to DB"]
    
    C1 -->|Configure| Transform["⚙️ Transform"]
    I1 -->|Process| Transform
    Transform -->|Output| O1
    Transform -->|Output| O2
    
    style Input fill:#bbdefb
    style Process fill:#c8e6c9
    style Output fill:#ffe0b2
    style Config fill:#f1f8e9
```

---

## API Call Flow

```mermaid
graph LR
    A["1. POST /upload<br/>with files"]
    B["2. Save to<br/>input/"]
    C["3. Spawn<br/>Python"]
    D["4. Read<br/>output CSV"]
    E["5. Import<br/>to DB"]
    F["6. Record<br/>session"]
    G["7. Return<br/>response"]
    
    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    
    A -->|Files| B
    B -->|Path| C
    C -->|CSV| D
    D -->|Rows| E
    E -->|Stats| F
    F -->|Status| G
    
    style A fill:#e3f2fd
    style B fill:#f3e5f5
    style C fill:#fff3e0
    style D fill:#f1f8e9
    style E fill:#fce4ec
    style F fill:#e0f2f1
    style G fill:#ffebee
```

---

## Error Handling - SAVEPOINT Strategy

```mermaid
graph TB
    A["Start Transaction"]
    B["Create SAVEPOINT"]
    C{"Insert Row"}
    D["✅ Success"]
    E["RELEASE SAVEPOINT"]
    F["❌ Error"]
    G["ROLLBACK TO SAVEPOINT"]
    H["Record Error"]
    I["Continue Next Row"]
    J["Commit Transaction"]
    
    A --> B
    B --> C
    C -->|Yes| D
    D --> E
    C -->|No| F
    F --> G
    G --> H
    E --> I
    H --> I
    I -->|More Rows?| B
    I -->|Done| J
    
    style A fill:#e8f5e9
    style B fill:#c8e6c9
    style C fill:#fff3e0
    style D fill:#a5d6a7
    style E fill:#a5d6a7
    style F fill:#ef9a9a
    style G fill:#ef9a9a
    style H fill:#ffcdd2
    style I fill:#ffe0b2
    style J fill:#a5d6a7
```

---

## Technology Stack

```mermaid
graph TB
    subgraph Frontend
        React["⚛️ React 18+"]
        Router["🔗 TanStack Router"]
        Query["📊 TanStack Query"]
        UI["🎨 Shadcn UI"]
    end
    
    subgraph Backend
        Node["📦 Node.js"]
        Fastify["⚡ Fastify"]
        TypeScript["🔷 TypeScript"]
        CSV["📋 csv-parse"]
    end
    
    subgraph Processing
        Python["🐍 Python 3.8+"]
        Pandas["📊 Pandas"]
        YAML["📝 PyYAML"]
        Openpyxl["📄 Openpyxl"]
    end
    
    subgraph Database
        PG["🗄️ PostgreSQL"]
        Pool["📡 pg (driver)"]
    end
    
    React --> Router
    React --> Query
    React --> UI
    
    Node --> Fastify
    Fastify --> TypeScript
    Fastify --> CSV
    
    Python --> Pandas
    Python --> YAML
    Python --> Openpyxl
    
    PG --> Pool
    Fastify --> Pool
    
    style Frontend fill:#e3f2fd
    style Backend fill:#f3e5f5
    style Processing fill:#fff3e0
    style Database fill:#ffebee
```

---

## Configuration Mapping Example

```mermaid
graph TB
    CSV["Input CSV<br/>BESCOM A Block<br/>Amount: 5000"]
    Mapping["mapping.yaml<br/>Utilities:<br/>- BESCOM A Block"]
    Category["✅ Category<br/>Utilities"]
    DB["Database<br/>transactions"]
    
    CSV -->|Check| Mapping
    Mapping -->|Found| Category
    Category -->|Insert| DB
    
    CSV2["Input CSV<br/>Unknown Item<br/>Amount: 1000"]
    Mapping2["mapping.yaml<br/>No match found"]
    DefaultCat["⚠️ Default Category<br/>Uncategorized"]
    DB2["Database<br/>transactions"]
    
    CSV2 -->|Check| Mapping2
    Mapping2 -->|Not found| DefaultCat
    DefaultCat -->|Insert| DB2
    
    style CSV fill:#bbdefb
    style Mapping fill:#c8e6c9
    style Category fill:#a5d6a7
    style DB fill:#e0f2f1
    style CSV2 fill:#ffccbc
    style Mapping2 fill:#ffab91
    style DefaultCat fill:#ffab91
    style DB2 fill:#ffccbc
```

---

## Integration with Existing System

```mermaid
graph TB
    ETL["🆕 ETL Integration<br/>New Feature"]
    
    Existing1["Existing: Import Batches<br/>admin.imports.ts"]
    Existing2["Existing: Transactions<br/>Database Table"]
    Existing3["Existing: Categories/Vendors<br/>Auto-created"]
    Existing4["Existing: Audit Log<br/>All operations"]
    
    ETL -->|Creates| Existing1
    Existing1 -->|Populates| Existing2
    ETL -->|References| Existing3
    ETL -->|Logs to| Existing4
    
    style ETL fill:#ffe0b2
    style Existing1 fill:#c8e6c9
    style Existing2 fill:#bbdefb
    style Existing3 fill:#f8bbd0
    style Existing4 fill:#d1c4e9
```

---

## Performance Timeline - Typical Upload

```mermaid
graph LR
    T0["0s<br/>Upload Start"]
    T1["1-2s<br/>File Save"]
    T2["2-5s<br/>Python Start"]
    T3["5-50s<br/>Transform"]
    T4["50-55s<br/>Import"]
    T5["55-60s<br/>Record"]
    
    T0 --> T1
    T1 --> T2
    T2 --> T3
    T3 --> T4
    T4 --> T5
    
    style T0 fill:#c8e6c9
    style T1 fill:#bbdefb
    style T2 fill:#ffe0b2
    style T3 fill:#ffccbc
    style T4 fill:#f8bbd0
    style T5 fill:#d1c4e9
```

---

**Visual architecture created to help understand the system!** 📊

