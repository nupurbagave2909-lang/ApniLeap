# ApniLeap Mini-Project Portfolio Portal with Bidirectional Jira Integration

[![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-v14+-blue.svg)](https://www.postgresql.org/)
[![Jira Cloud](https://img.shields.io/badge/Jira%20Cloud-REST%20API%20v3-0052CC.svg)](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
[![Bootstrap](https://img.shields.io/badge/Bootstrap-5.3-7952B3.svg)](https://getbootstrap.com/)

ApniLeap is an enterprise academic project governance platform designed for multi-tier engineering programs. It enables institutional leaders, Deans, Heads of Department (HODs), Faculty Guides/Mentors, and Student Teams to manage, monitor, and evaluate student mini-projects with automated RAG (Red/Yellow/Green) governance, KPI metrics, issue tracking, and **seamless bidirectional integration with Atlassian Jira Cloud Kanban boards**.

---

## Table of Contents
1. [Key Features](#key-features)
2. [Jira Integration Architecture](#jira-integration-architecture)
   - [Target Projects: ALKLE023 & ALKLE026](#target-projects-alkle023--alkle026)
   - [Bidirectional Kanban Synchronization](#bidirectional-kanban-synchronization)
   - [Challenges / Issues Sync to Jira](#challenges--issues-sync-to-jira)
   - [KPI Tracking & Jira Reflection](#kpi-tracking--jira-reflection)
   - [Status & Transition Mapping](#status--transition-mapping)
3. [Database Architecture & Seeding](#database-architecture--seeding)
   - [Schema Overview](#schema-overview)
   - [Seed Script Integrity & Idempotency](#seed-script-integrity--idempotency)
4. [In-Site Seamless Refresh](#in-site-seamless-refresh)
5. [Setup & Installation Guide](#setup--installation-guide)
   - [1. Prerequisites](#1-prerequisites)
   - [2. Environment Variables (.env)](#2-environment-variables-env)
   - [3. Database Initialization & Seeding](#3-database-initialization--seeding)
   - [4. Start Application](#4-start-application)
6. [Pre-Configured Demo Credentials](#pre-configured-demo-credentials)
7. [Step-by-Step Testing & Verification Walkthrough](#step-by-step-testing--verification-walkthrough)
8. [Project Structure](#project-structure)

---

## Key Features

- **Multi-Level Governance Dashboards**: High-level portfolio overview $\rightarrow$ Institute Drilldown $\rightarrow$ Department Drilldown $\rightarrow$ Theme Clusters $\rightarrow$ Individual Project Dashboards.
- **RAG Status Governance**: Strict transition rules (`GREEN` $\leftrightarrow$ `YELLOW` $\leftrightarrow$ `RED`) with mandatory reason logging and audit trail.
- **Interactive Project Workspace (Kanban Board)**: Built-in Kanban columns (`To Do`, `In Progress`, `Completed`) synchronized live with Jira boards.
- **Challenges & Corrective Actions**: Student-logged bottlenecks automatically generate Jira issues, paired with corrective action plans and mentor verification.
- **Key Performance Indicators (KPIs)**: Quantitative target vs. measured tracking with evidence documentation.
- **Student Team Management**: 4-member team assignments per project with automatic SRN-based student login generation.
- **In-Site Instant Refresh**: Refresh data in-place without hard page reloads (`F5`) or resetting UI scroll state.

---

## Jira Integration Architecture

The portal integrates directly with **Atlassian Jira Cloud** using Jira REST API v2/v3 with Bearer / Basic API token authentication.

```
┌─────────────────────────────────┐                 ┌─────────────────────────────────┐
│       ApniLeap Platform         │                 │       Atlassian Jira Cloud      │
│  (http://localhost:4000)        │                 │  (https://*.atlassian.net)      │
├─────────────────────────────────┤                 ├─────────────────────────────────┤
│ • Project Workspace             │                 │ • Kanban Board                  │
│   - To Do Column                │ <═════════════> │   - To Do (ID: 10014)           │
│   - In Progress Column          │  Bidirectional  │   - In Progress (ID: 10012/15)  │
│   - Completed Column            │   Status Sync   │   - Done (ID: 10013)            │
│                                 │                 │                                 │
│ • Challenges & Roadblocks       │ ──────────────> │ • Jira Issues (Bug / Task)      │
│ • KPI Metrics & Measurements    │ ──────────────> │ • Custom Descriptions & Labels  │
└─────────────────────────────────┘                 └─────────────────────────────────┘
```

### Target Projects: ALKLE023 & ALKLE026

The platform is pre-configured and linked to two dedicated Jira Kanban boards:

| ApniLeap Project Code | Jira Project Key | Project Name | Jira Board URL |
|:----------------------|:-----------------|:-------------|:---------------|
| `AL-KLE-023` | `ALKLE023` | Adaptive Video Streaming & Buffer Management Engine | `https://apnileap-portfolio.atlassian.net/jira/software/projects/ALKLE023/boards/2` |
| `AL-KLE-026` | `ALKLE026` | Smart Campus Lab & Resource Optimizer | `https://apnileap-portfolio.atlassian.net/jira/software/projects/ALKLE026/boards/3` |

### Bidirectional Kanban Synchronization

1. **Jira $\rightarrow$ ApniLeap Sync**:
   - Calling `GET /api/projects/:id/workspace-tasks` queries Jira Cloud via `GET /rest/api/3/search?jql=project="KEY"`.
   - Each Jira issue (summary, status, priority, assignee) is parsed, synced into local Postgres table `workspace_tasks`, and rendered on the Kanban board.
2. **ApniLeap $\rightarrow$ Jira Sync**:
   - When a student or mentor moves a task (`<- To Do`, `In Progress ->`, `Completed ✓`):
     - ApniLeap calls `PUT /api/projects/:id/workspace-tasks/:taskId`.
     - The service determines the available Jira workflow transitions via `GET /rest/api/3/issue/{issueKey}/transitions`.
     - It posts the matching transition ID to `POST /rest/api/3/issue/{issueKey}/transitions`.
     - The issue updates immediately on the Jira Kanban board.

### Status & Transition Mapping

Jira software boards have project-specific transition workflows. ApniLeap dynamically resolves and maps states:

| ApniLeap Board Column | Target Jira Status Category | Jira Status Name & ID | Transition Target |
|:----------------------|:----------------------------|:----------------------|:------------------|
| **To Do** | `To Do` | `To Do` / `to-do` (ID: `10014`) | Transition to `To Do` |
| **In Progress** | `In Progress` | `In Progress` (ID: `10015`), `Selected for development` (ID: `10012`) | Transition to `In Progress` |
| **Completed** | `Done` | `Done` / `done` (ID: `10013`) | Transition to `Done` |

### Challenges / Issues Sync to Jira

- When a challenge is logged under **Project Tracking $\rightarrow$ Challenges & Actions**:
  - The challenge is recorded in the PostgreSQL `issues` table.
  - ApniLeap automatically triggers `createJiraIssueForChallenge()`.
  - It creates a corresponding Jira issue in the linked project (`ALKLE023` or `ALKLE026`):
    - **Issue Type**: `Task` or `Bug`
    - **Summary**: `[Challenge] <Title>`
    - **Description**: Documented Root Cause, Business/Academic Impact, and Support Required.
    - **Labels**: `apnileap-challenge`, `student-blocker`.

### KPI Tracking & Jira Reflection

- Projects carry custom quantitative KPIs (e.g., *End-to-End Streaming Latency*, *Pipeline Throughput*, *GPU Utilization*).
- Recorded measurements are synced to Jira sprint logs and linked Jira project descriptions, ensuring mentors tracking via Jira have full visibility into metric progression.

---

## Database Architecture & Seeding

The database runs on PostgreSQL with standard UUID primary keys and strict relational integrity.

### Schema Overview

Key tables in [`backend/db/schema.sql`](file:///C:/Users/Nupur/ApniLeap/backend/db/schema.sql):
- `institutes`, `departments`, `themes`: Multi-tier institutional hierarchy.
- `users`, `roles`, `user_roles`: Role-based access control (Platform Admin, Dean, HOD, Mentor, Reviewer, Student).
- `projects`: Core project records with code, title, RAG status, completion percentage.
- `jira_links`: Relates `project_id` $\leftrightarrow$ `jira_issue_key` (`ALKLE023`, `ALKLE026`).
- `workspace_tasks`: Stores Kanban cards with priority, status, and Jira keys.
- `kpis` & `kpi_measurements`: Metric targets and dated evidence submissions.
- `issues` & `corrective_actions`: Roadblocks and action items with resolution evidence.
- `milestones`: Deliverables with target completion dates.

### Seed Script Integrity & Idempotency

[`backend/db/seed.js`](file:///C:/Users/Nupur/ApniLeap/backend/db/seed.js) has been designed to guarantee **error-free, idempotent database initialization**:

1. **Pre-Checks Before Insert**: All entities use `SELECT ... WHERE` checks or `ON CONFLICT` clauses to prevent duplicate key or constraint violations.
2. **Jira Board Links**: Automatically creates `jira_links` entries for `AL-KLE-023` $\leftrightarrow$ `ALKLE023` and `AL-KLE-026` $\leftrightarrow$ `ALKLE026`.
3. **Pre-Seeded KPIs**:
   - `AL-KLE-023`: End-to-End Streaming Latency (`50 ms`), Buffer Underflow Rate (`1 %`), Frame Rendering Throughput (`60 fps`).
   - `AL-KLE-026`: Model Inference Latency (`50 ms`), Pipeline Reliability (`99 %`), Test Coverage (`85 %`).
4. **Pre-Seeded Milestones & Challenges**: Realistic engineering milestones and challenges populated with active corrective actions.
5. **Real Student Roster**: Reads `backend/db/data/cseai_teams.json` to seed student teams and generate login credentials.

---

## In-Site Seamless Refresh

A common pain point in single-page and multi-page dashboard portals is requiring manual browser hard refreshes (`F5` / `Ctrl+Shift+R`) to view live updates from third-party tools like Jira.

ApniLeap provides an **in-place asynchronous refresh engine**:
- **Global Refresh Button (`🔄 Refresh`)**: Located in the top navbar across all pages.
- **Contextual Action Refresh**: Located in Project Dashboard and Project Workspace headers.
- **Mechanism**:
  - Triggers `window.ApniLeap.triggerRefresh()`.
  - Animates the icon with `.spinning` CSS keyframes.
  - Concurrently re-fetches Project Metadata, Kanban tasks from Jira, KPIs, Challenges, and Milestones.
  - Seamlessly re-renders the DOM without resetting scroll position or page state.

---

## Setup & Installation Guide

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **PostgreSQL**: v14.0 or higher
- **Git**

### 2. Environment Variables (.env)
Create a `.env` file in `backend/.env` (use `backend/.env.example` as a template):

```ini
# Server
PORT=4000
NODE_ENV=development

# PostgreSQL Database
PGHOST=localhost
PGPORT=5432
PGDATABASE=apnileap_portfolio
PGUSER=postgres
PGPASSWORD=your_postgres_password

# Authentication
JWT_SECRET=super_secret_jwt_key_apnileap_2026
JWT_EXPIRES_IN=8h

# Atlassian Jira Cloud Integration
JIRA_BASE_URL=https://apnileap-portfolio.atlassian.net
JIRA_EMAIL=your_atlassian_account_email@domain.com
JIRA_API_TOKEN=your_atlassian_api_token
JIRA_PROJECT_KEY=ALKLE026

# Atlassian Confluence Integration (Optional)
CONFLUENCE_BASE_URL=https://apnileap-portfolio.atlassian.net/wiki
CONFLUENCE_EMAIL=your_atlassian_account_email@domain.com
CONFLUENCE_API_TOKEN=your_atlassian_api_token
CONFLUENCE_SPACE_KEY=AL
```

> **How to get a Jira API Token**:
> 1. Sign in to [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
> 2. Click **Create API token**, label it `ApniLeap-Integration`, and copy the token into `JIRA_API_TOKEN`.

### 3. Database Initialization & Seeding

```powershell
# Navigate to backend directory
cd C:\Users\Nupur\ApniLeap\backend

# Install dependencies
npm install

# Initialize PostgreSQL Schema
npm run db:init

# Seed database with projects, student rosters, Jira links, KPIs, and milestones
npm run seed
```

### 4. Start Application

```powershell
# Start the backend server
npm start
```

The portal will be running at: **`http://localhost:4000`**

---

## Pre-Configured Demo Credentials

All seeded accounts use password: **`Demo@12345`**

| Role | Email | Scope of Access |
|:-----|:------|:----------------|
| **Platform Admin** | `platform.admin@apnileap.org` | Global oversight, all institutes, users, system settings |
| **Dean / Principal** | `kle.dean@apnileap.org` | KLE Technological University institutional oversight |
| **HOD (CSE-AI)** | `kle.hod.cseai@apnileap.org` | CSE (AI) Department themes and project tracking |
| **HOD (CSE)** | `kle.hod.cse@apnileap.org` | CSE Department themes and project tracking |
| **Faculty Mentor** | `kle.mentor@apnileap.org` | Assigned projects, Kanban board, KPI updates, status changes |
| **Reviewer** | `kle.reviewer@apnileap.org` | Independent assessment and status recommendations |
| **Student** | Any Student SRN (e.g. `01FE23BCS001` or team member SRN) | Direct access to own team's project workspace & challenges |

---

## Step-by-Step Testing & Verification Walkthrough

### 1. Test Project Tracking & KPIs
1. Log in with `kle.mentor@apnileap.org` (`Demo@12345`).
2. Open project **`AL-KLE-026`** (Smart Campus Lab & Resource Optimizer).
3. Click the **`KPIs`** button in the top action bar (or the *KPIs* tab under *Project Tracking*).
4. Verify the 3 seeded KPIs are visible with targets (`50 ms`, `99 %`, `85 %`).
5. Click **`+ Add Measurement`** to record a new reading with evidence.

### 2. Test Challenges & Automatic Jira Creation
1. On project `AL-KLE-026` or `AL-KLE-023`, click **`Challenges`** button.
2. Click **`+ Add Challenge`**.
3. Fill in:
   - **Title**: `Memory saturation on distributed cache cluster`
   - **Root Cause**: `Redis node eviction threshold exceeded`
   - **Impact**: `Slow query lookups by student UI clients`
   - **Support Required**: `Additional RAM allocation on lab compute cluster`
4. Submit. The challenge appears immediately under *Challenges & Corrective Actions* and creates a linked Jira issue on the respective Jira board (`ALKLE026` / `ALKLE023`).

### 3. Test Bidirectional Kanban Board Sync
1. Click **`Project Workspace`** in the project header.
2. Notice the cards in **To Do**, **In Progress**, and **Completed**.
3. Click **`In Progress →`** on a To Do card.
4. Check your Jira Kanban board (`https://apnileap-portfolio.atlassian.net/jira/software/projects/ALKLE026/boards/3`).
   - The card moves to **In Progress** in Jira automatically!
5. In Jira, drag an issue into **Done** or **To Do**.
6. Switch back to ApniLeap and click **`🔄 Refresh`** or **`🔄 Sync Jira`**.
   - The card moves instantly on the ApniLeap board without a full browser reload!

---

## Project Structure

```
ApniLeap/
├── backend/
│   ├── config/
│   │   └── db.js                 # PostgreSQL connection pool configuration
│   ├── controllers/
│   │   ├── project.controller.js  # Project CRUD and status management
│   │   ├── workspace.controller.js# Kanban board and task actions
│   │   ├── kpi.controller.js      # KPI metrics & measurements
│   │   ├── issue.controller.js    # Challenges and issue logging
│   │   └── action.controller.js   # Corrective actions management
│   ├── db/
│   │   ├── schema.sql             # Relational PostgreSQL database schema
│   │   ├── seed.js                # Idempotent seed script with Jira links & KPIs
│   │   ├── init.js                # Schema runner
│   │   └── data/
│   │       └── cseai_teams.json   # Real CSE-AI student teams and guides
│   ├── routes/
│   │   ├── project.routes.js      # Project endpoints
│   │   └── entity.routes.js       # Department, theme, KPI, and workspace routes
│   ├── services/
│   │   ├── jira.service.js        # Full bidirectional Jira Cloud API integration
│   │   └── confluence.service.js  # Confluence API integration
│   ├── server.js                  # Express application entrypoint
│   └── package.json
├── frontend/
│   ├── css/
│   │   └── styles.css             # Modern styling and refresh animation keyframes
│   ├── js/
│   │   ├── api.js                 # Fetch wrapper and global refresh coordinator
│   │   ├── dashboard.js           # Portfolio overview controller
│   │   ├── project-dashboard.js   # Project dashboard, KPIs, and Challenges
│   │   └── project-workspace.js   # Kanban board controller with Jira sync
│   └── pages/
│       ├── dashboard.html          # Main portfolio page
│       ├── project-dashboard.html  # Project details, KPIs, Challenges
│       ├── project-workspace.html  # Jira Kanban board workspace
│       ├── reports.html            # Weekly executive reports
│       └── administration.html     # Administration & user management
├── README_with_JIRA.md            # Comprehensive Jira and project guide
└── README.md
```
