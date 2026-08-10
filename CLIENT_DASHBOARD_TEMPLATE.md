# OptiStrat client dashboard template

The Pandrol dashboard is the pilot implementation for reusable public client reporting.

## Source-of-truth rule

ClickUp remains the operational system of record. The public website contains only a generated reporting snapshot and the display code. Do not manually maintain project status in the frontend.

## Add a future project

1. Copy `projects/pandrol-sara-2026/` to `projects/<client>/<project-slug>/`.
2. Copy `config/projects/pandrol-sara-2026.json` and replace the project/list IDs, public path, dates, milestones and publication tags.
3. Run `scripts/sync-clickup.mjs` with `PROJECT_CONFIG` pointing to the new configuration.
4. Add the new sync command to the existing workflow.
5. Tag only approved public risks, issues and client-attention actions in ClickUp.

## Security model

- The ClickUp API token exists only as the GitHub Actions secret `CLICKUP_API_TOKEN`.
- Browser code never calls ClickUp directly.
- Only generated `project.json` is public.
- Risks/issues require an explicit client-visible publication tag.
- Client-attention items require an explicit attention/approval/decision tag.

## First-project configuration

- ClickUp list: `Projects` (`901218737577`)
- Project parent task: `PROJ-1360` (`869edm1p7`)
- Public path: `/projects/pandrol-sara-2026/`
- Refresh cadence: twice per hour, at minutes 7 and 37
