# Database — Entity Relationship

PostgreSQL schema managed by **Prisma 7** (`prisma/schema.prisma`). All primary keys
are `cuid()` strings. This diagram is generated from the current schema and renders
natively on GitHub.

```mermaid
erDiagram
    MenuItem ||--o{ OrderItem : "ordered as"
    Order ||--o{ OrderItem : "contains"
    Order ||--o| PaymentRecord : "paid by"
    OrderItem ||--o| KitchenJob : "baked as"

    MenuItem {
        string id PK
        string name
        Category category
        decimal price "Decimal(10,2)"
        int bake_minutes
        boolean available "default true"
        datetime createdAt
    }

    Order {
        string id PK
        string customerId "nullable"
        PriorityLevel priorityLevel
        OrderStatus status "default PENDING"
        decimal totalPrice "Decimal(10,2)"
        datetime estimatedReadyAt "nullable"
        datetime createdAt
    }

    OrderItem {
        string id PK
        string orderId FK
        string menuItemId FK
        int quantity
    }

    KitchenJob {
        string id PK
        string orderItemId FK,UK
        KitchenJobStatus status "default QUEUED"
        int ovenNumber
        int slotNumber
        datetime bakeStartedAt "nullable"
        datetime bakeDoneAt "nullable"
    }

    PaymentRecord {
        string id PK
        string orderId FK,UK
        PaymentMethod method
        decimal amount "Decimal(10,2)"
        PaymentStatus status "default PENDING"
        datetime paidAt "nullable"
    }

    User {
        string id PK
        string email UK
        string password "bcrypt hash"
        Role role
        datetime createdAt
    }
```

**Cardinality notes**

- `MenuItem 1—N OrderItem` — a catalogue item appears in many order lines.
- `Order 1—N OrderItem` — an order is composed of one or more line items.
- `Order 1—0..1 PaymentRecord` — `PaymentRecord.orderId` is `@unique`, so each order
  has at most one payment.
- `OrderItem 1—0..1 KitchenJob` — `KitchenJob.orderItemId` is `@unique`; the job is
  created only once the item starts baking (`QUEUED` jobs live in memory, not in the DB).
- `User` is standalone — there is no FK from `Order.customerId` to `User`; the customer
  id is taken from the JWT claim, not a database relation.

## Enumerations

| Enum | Values |
|---|---|
| `Role` | `CUSTOMER` · `STORE_MANAGER` · `KITCHEN_MANAGER` |
| `Category` | `COOKIE` · `PASTRY` · `BREAD` |
| `PriorityLevel` | `TIER1` · `TIER2` · `TIER3` |
| `OrderStatus` | `PENDING` → `BAKING` → `READY` → `PAID` |
| `PaymentMethod` | `CASH` · `CARD` |
| `PaymentStatus` | `PENDING` · `COMPLETED` |
| `KitchenJobStatus` | `QUEUED` · `BAKING` · `DONE` |
