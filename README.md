# REQFLOW PRO

Digital requisition processing system with automated multi-stage approval workflows.

## Mock Authentication

This version uses local mock authentication. No external database setup is required.

### Predefined Users
| Username | Password | Role |
| :--- | :--- | :--- |
| `admin` | `password123` | System Administrator |
| `director` | `password123` | Managing Director |
| `finance` | `password123` | Finance HOD |
| `ops` | `password123` | Operations Manager |
| `requester` | `password123` | Site Requester |

## Local Persistence

Data is persisted locally in your browser using **IndexedDB (via Dexie)**. Clearing your browser cache or site data will reset the application state.

## Admin Panel

Access the **Administrator Entrance** from the login screen.
- **Admin Password**: `Admin50$` or `Action50$`.
