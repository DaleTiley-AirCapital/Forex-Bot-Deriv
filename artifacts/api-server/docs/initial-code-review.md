# Initial Code Review (Phase 1 Audit)

Date: 2026-04-09
Scope: monorepo baseline architecture + UI/backend parity + dead/duplicate risk scan.

## Template 1 — Repo Audit Summary

### File Inventory
| File | Responsibility | Imported By | Status |
|------|---------------|-------------|--------|
| `artifacts/api-server/src/app.ts` | Express app wiring + static frontend serving | `artifacts/api-server/src/index.ts` | active, mixed responsibility (API + static hosting + path fallback) |
| `artifacts/api-server/src/routes/index.ts` | Registers API sub-routers | `artifacts/api-server/src/app.ts` | active |
| `artifacts/api-server/src/routes/signals.ts` | Signal scan/read endpoints | route index | active |
| `artifacts/api-server/src/routes/trades.ts` | Trading mode, open/history/positions endpoints | route index | active |
| `artifacts/api-server/src/routes/settings.ts` | Platform settings + AI status/health endpoints | route index | active |
| `artifacts/api-server/src/core/tradeEngine.ts` | Trading decision + execution path entrypoint | route handlers/runtime jobs | active |
| `artifacts/api-server/src/core/signalRouter.ts` | Signal routing/selection logic | core strategy flow | active |
| `artifacts/api-server/src/core/strategies.ts` | Strategy definitions / scoring inputs | signal router | active |
| `artifacts/api-server/src/runtimes/backtestEngine.ts` | Backtest runtime orchestration | backtest/research routes | active |
| `artifacts/deriv-quant/src/App.tsx` | Frontend route shell + setup gate | `artifacts/deriv-quant/src/main.tsx` | active |
| `artifacts/deriv-quant/src/pages/*` | User-facing pages | frontend router | active |
| `artifacts/mockup-sandbox/src/*` | Parallel UI sandbox implementation | standalone package entry only | duplicate/parallel implementation risk |
| `lib/api-spec/openapi.yaml` | API contract source | codegen pipelines | active source of truth |
| `lib/api-client-react/src/generated/*` | Generated React API client | deriv-quant pages | active generated output |
| `lib/api-zod/src/generated/*` | Generated zod client/types | api-server + other libs | active generated output |

### Duplicate/Overlap Groups
- UI component overlap: `artifacts/deriv-quant/src/components/ui/*` and `artifacts/mockup-sandbox/src/components/ui/*`.
- UI utility overlap: `artifacts/deriv-quant/src/hooks/*` and `artifacts/mockup-sandbox/src/hooks/*`.
- App-shell overlap: `artifacts/deriv-quant/src/App.tsx` and `artifacts/mockup-sandbox/src/App.tsx` (parallel UI variants).

### Mixed-Responsibility Files
- `artifacts/api-server/src/app.ts`: API middleware, static hosting, and multi-path fallback resolution in one file.
- `artifacts/api-server/src/routes/setup.ts`: long workflow orchestration + progress streaming + reset logic in one route module.
- `artifacts/deriv-quant/src/pages/settings.tsx`: setup wizard controls, diagnostics, risk kill switch, AI health/status, and full settings editor in one page.

### Dead/Legacy/Fallback Code
- `artifacts/api-server/src/app.ts`: path-resolution fallback (`try/catch` and `candidatePaths.find`) keeps multiple runtime path branches.
- `artifacts/mockup-sandbox/*`: appears isolated as a separate package; not referenced by server build path and likely legacy/prototype track.
- Multiple frontend `catch {}` blocks in settings/research paths silently swallow errors instead of surfacing actionable failures.

### UI Routes/Components Identified
- `/` dashboard overview
- `/research` research runner + backtest + AI analysis
- `/signals` latest signal monitoring
- `/trades` open/history/position management
- `/data` stream controls + ticks/candles/spikes
- `/settings` setup controls + diagnostics + risk + AI + system settings
- `/help` API/version and help diagnostics

### Backend Endpoints/Functions Identified
- Health/version: `/api/healthz`, `/api/version`
- Setup: `/api/setup/*`
- Data: `/api/data/*`
- Signals: `/api/signals/*`
- Trades: `/api/trade/*`
- Portfolio/overview: `/api/portfolio/*`, `/api/overview`
- Risk: `/api/risk/*`
- Settings: `/api/settings*`
- Research: `/api/research/*`
- Diagnostics: `/api/diagnostics/*`
- Account: `/api/account/*`
- Export: `/api/export/research`
- AI chat: `/api/ai/chat` and `/api/research/ai-chat`

### UI-to-Endpoint Mapping (preliminary)
| UI Item | Expected Backend | Wired? | Notes |
|---------|-----------------|--------|-------|
| Setup gate + setup page | `/api/setup/status`, `/api/setup/preflight`, `/api/setup/initialise`, `/api/setup/reset` | yes | present in App/setup/settings |
| Data page stream control | `/api/data/stream/start`, `/api/data/stream/stop`, `/api/data/status`, `/api/data/ticks`, `/api/data/candles`, `/api/data/spikes` | yes | through generated client hooks |
| Research page | `/api/research/data-status`, `/api/research/download-simulate`, `/api/research/rerun-backtest`, `/api/research/backtest-history`, `/api/research/ai-chat` | yes | direct fetch usage |
| Signals page | `/api/signals/latest` + detail endpoints | yes | generated client usage |
| Trades page | `/api/trade/open`, `/api/trade/history`, `/api/trade/positions`, `/api/trade/stop` | yes | generated client usage |
| Settings page diagnostics | `/api/diagnostics/symbols`, `/api/diagnostics/symbols/revalidate` | yes | direct fetch usage |
| Settings page risk actions | `/api/risk/kill-switch` | yes | direct fetch usage |
| Help page version | `/api/version` | yes | direct fetch usage |
| Account mode switching UI | `/api/account/set-mode` | no (visible mismatch) | endpoint exists; no clear dedicated UI action |
| Research export endpoint | `/api/export/research` | partial | not clearly surfaced as a distinct user action |

---

## Template 2 — Dead/Duplicate File Report

### Confirmed Dead Files (zero imports, zero callers)
- None conclusively marked deleted in this review pass (initial audit only).

### Confirmed Duplicate Logic
- `artifacts/mockup-sandbox/src/components/ui/*` duplicates `artifacts/deriv-quant/src/components/ui/*` concern space (parallel design-system copies).
- `artifacts/mockup-sandbox/src/hooks/*` duplicates `artifacts/deriv-quant/src/hooks/*` concern space.

### Backup/Temp/Alternate Implementation Files
- No `*v2*`, `*backup*`, `*temp*`, `*old*`, `*final*` filenames detected in active source folders.

### Fallback Branches Identified
- `artifacts/api-server/src/app.ts` (static path resolution) — multiple fallback candidates for frontend dist path.
- `artifacts/api-server/src/app.ts` (`try/catch` around `fileURLToPath`) — fallback to `__dirname || process.cwd()`.

### Commented-Out Dead Code
- None obvious in sampled core/router files.

---

## Template 3 — Deletion Plan

### Files to Delete
| File | Reason | Safe to Delete? | Replacement (if any) |
|------|--------|----------------|----------------------|
| `artifacts/mockup-sandbox/` (entire package) | Parallel UI implementation duplicates active app concerns | confirm usage first | `artifacts/deriv-quant/` |

### Fallback Branches to Remove
| File | Line(s) | Description |
|------|---------|-------------|
| `artifacts/api-server/src/app.ts` | static-path block | Replace multi-candidate static path fallback with single deployment contract |
| `artifacts/api-server/src/app.ts` | `try/catch` around `fileURLToPath` | Remove ambiguous runtime fallback path branch |

### Commented-Out Code to Remove
| File | Line(s) | Description |
|------|---------|-------------|
| n/a | n/a | none in this pass |

### Callers to Update After Deletion
| Deleted File/Export | Callers Affected | Update Required |
|--------------------|-----------------|-----------------|
| `@workspace/mockup-sandbox` package | workspace scripts / CI if present | remove package from workspace globs or mark archived outside active workspace |

---

## Template 4 — Refactor Plan

### Source-of-Truth Declarations
| Concern | Canonical File | Previous Locations (to be deleted) |
|---------|---------------|-------------------------------------|
| Active user-facing frontend | `artifacts/deriv-quant/src/*` | `artifacts/mockup-sandbox/src/*` |
| API route registration | `artifacts/api-server/src/routes/index.ts` | none |
| API schema contract | `lib/api-spec/openapi.yaml` | ad-hoc route typing |
| Generated frontend API hooks | `lib/api-client-react/src/generated/*` | direct ad-hoc fetch wrappers where feasible |

### Consolidation Moves
| Logic Being Moved | From | To | Direct Callers After Move |
|------------------|------|----|--------------------------|
| Setup + diagnostics UI sections decomposition | `artifacts/deriv-quant/src/pages/settings.tsx` | dedicated section components under `artifacts/deriv-quant/src/components/` | `settings.tsx` only |
| Static hosting path policy | `artifacts/api-server/src/app.ts` | dedicated infra config helper | `app.ts` |

### Runtime Wrapper Cleanup
| Runtime | Current Extra Logic | Should Be in Core | Action |
|---------|-------------------|-------------------|--------|
| Backtest runtime | orchestration + route-adjacent shaping | partly | keep orchestration in runtime, ensure trading decisions remain only in `core/` |
| Setup route runtime | long in-route orchestration | yes (partly) | move orchestration to infrastructure/service layer |

### New Files to Create (if any)
| File | Responsibility | Replaces |
|------|---------------|---------|
| `artifacts/api-server/src/infrastructure/frontendDist.ts` | single-source frontend dist resolution | path fallback logic embedded in `app.ts` |
| `artifacts/deriv-quant/src/components/settings/*` | split settings mega-page into maintainable sections | monolithic `settings.tsx` sections |

---

## Template 5 — UI-to-Endpoint Mismatch Report

### UI Items with No Backend (Remove These)
| UI Component/Action | Expected Backend | Disposition |
|--------------------|-----------------|-------------|
| none confirmed in this pass | n/a | keep |

### Backend Endpoints with No UI Wiring (Wire These)
| Endpoint/Function | Purpose | UI Location to Wire |
|------------------|---------|---------------------|
| `POST /api/account/set-mode` | explicit account mode selection | settings account panel / global mode selector |
| `POST /api/export/research` | export research package | research page explicit “Export Research Bundle” action (if intended user-facing) |

### Partially Wired Items (Fix These)
| UI Item | Backend | Issue | Fix Required |
|---------|---------|-------|--------------|
| Settings diagnostics + setup actions | multiple `/api/setup/*` + `/api/diagnostics/*` calls | several silent `catch {}` blocks hide errors from users | surface toast/error state with retry context |
| AI chat feature | `/api/ai/chat` and `/api/research/ai-chat` | split endpoint purpose may confuse ownership | declare one public endpoint or clearly separate scopes |

---

## Template 6 — Validation

### Deleted files
- None in this initial review pass (audit/report only).

### Consolidated files
- None yet (review establishes target actions).

### Moved files
- None yet.

### Canonical source-of-truth files
- API schema: `lib/api-spec/openapi.yaml`
- Frontend app: `artifacts/deriv-quant/src/*`
- API server entry + route registration: `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/index.ts`

### UI items removed
- None in this initial review pass.

### UI items newly wired
- None in this initial review pass.

### Endpoint changes
- None in this initial review pass.

### Remaining explicit technical debt
1. Parallel UI package (`mockup-sandbox`) likely duplicates active surface area and increases drift risk.
2. `settings.tsx` and `setup.ts` are high-complexity files with mixed concerns.
3. Fallback path logic in API static hosting should be replaced with explicit deployment contract.
4. Silent error-swallow patterns in frontend reduce observability and operator trust.
5. Potential backend/user-facing endpoint parity gaps (`/api/account/set-mode`, `/api/export/research`).
