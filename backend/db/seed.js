const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const { ensureStudentAccounts } = require('../services/student-account.service');

const ROLES = [
    ['PLATFORM_ADMIN', 'Platform Administrator', 'Manages institutes, users, roles, policies and system configuration'],
    ['GLOBAL_PROGRAMME_LEADER', 'Global Programme Leader', 'Views portfolio and reviews projects across authorized institutes'],
    ['INSTITUTE_ADMIN', 'Institute Administrator', 'Manages one assigned institute'],
    ['DEAN_PRINCIPAL', 'Dean/Principal', 'Views institutional portfolio and reviews risk'],
    ['DEPARTMENT_HEAD', 'Department Head', 'Views and reviews departmental projects and mentor actions'],
    ['FACULTY_MENTOR', 'Faculty Mentor', 'Updates status, milestones, issues, evidence and corrective actions'],
    ['REVIEWER', 'Reviewer/Success Coach', 'Reviews progress and recommends status'],
    ['STUDENT', 'Student', 'Signs in with the SRN; sees only the own team and its project, read-only'],
    ['READ_ONLY_STAKEHOLDER', 'Read-only Stakeholder', 'Views dashboards and approved reports only'],
];

const INSTITUTES = [
    ['KLE', 'KLE Technological University (Hubballi Campus)'],
    ['MMCOE', 'Marathwada Mitra Mandal College of Engineering'],
    ['RIT', 'Rajarambapu Institute of Technology'],
    ['COEP', 'College of Engineering, Pune'],
    ['SANGLI', 'Sangli Institute of Technology'],
];

// Order institutes are listed in: KLE first, then COEP, then the rest.
// (Kept separate from INSTITUTES above, whose order determines project codes.)
const DISPLAY_ORDER = { KLE: 1, COEP: 2, MMCOE: 3, RIT: 4, SANGLI: 5 };


// KLE's first department is Computer Science and Engineering (the order matters:
// it keeps the existing project codes stable). Its second CSE department, (AI),
// is created further below.
const DEPARTMENTS_BY_INSTITUTE = {
    KLE: [
        { code: 'CSE', name: 'Computer Science and Engineering' },
    ],
};
// Only KLE carries departments and sample projects. The other institutes are
// kept as organisation names only, so they get no departments or projects.
const departmentsOf = (instCode) => DEPARTMENTS_BY_INSTITUTE[instCode] || [];

// KLE's second department. A Dean is given access to departments (both here) and
// each Department Head to their own department.
const KLE_EXTRA_DEPARTMENTS = [
    { code: 'CSE', headEmail: 'kle.hod.cse@apnileap.org' },
    { code: 'CSEAI', name: 'Computer Science and Engineering (AI)', headEmail: 'kle.hod.cseai@apnileap.org' },
];
const KLE_DEAN_EMAIL = 'kle.dean@apnileap.org';

const DEMO_PASSWORD = 'Demo@12345';

// Every project has a fixed team of four students. These are made-up demo
// people; real teams are entered through the app.
const DEMO_FIRST = ['Aarav', 'Diya', 'Rohan', 'Ananya', 'Kabir', 'Meera', 'Vihaan', 'Isha', 'Arjun', 'Riya', 'Karthik', 'Sneha'];
const DEMO_LAST = ['Kulkarni', 'Patil', 'Naik', 'Desai', 'Joshi', 'Hegde', 'Shetty', 'Bhat', 'Kamat', 'Pai'];
function demoTeam(seed) {
    return [0, 1, 2, 3].map((slot) => {
        const n = seed * 4 + slot;
        return {
            slot: slot + 1,
            name: `${DEMO_FIRST[n % DEMO_FIRST.length]} ${DEMO_LAST[(n * 7 + slot) % DEMO_LAST.length]}`,
            srn: `01FE23BCS${String(100 + n).padStart(3, '0')}`,
            semester: 5,
            division: 'ABC'[n % 3],
        };
    });
}

async function seed() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Roles
        const roleIds = {};
        for (const [code, name, description] of ROLES) {
            const { rows } = await client.query(
                `INSERT INTO roles (code, name, description) VALUES ($1,$2,$3)
                 ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
                 RETURNING id, code`,
                [code, name, description]
            );
            roleIds[rows[0].code] = rows[0].id;
        }
        console.log('Roles seeded:', Object.keys(roleIds).length);

        // Institutes
        const instituteIds = {};
        for (const [code, name] of INSTITUTES) {
            const { rows } = await client.query(
                `INSERT INTO institutes (code, name, display_order) VALUES ($1,$2,$3)
                 ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, display_order = EXCLUDED.display_order
                 RETURNING id, code`,
                [code, name, DISPLAY_ORDER[code] ?? 100]
            );
            instituteIds[rows[0].code] = rows[0].id;
        }
        console.log('Institutes seeded:', Object.keys(instituteIds).length);

        // One-off rename for databases seeded before schools existed: KLE's
        // "Computer Science" (COMP) becomes "Computer Science and Engineering" (CSE).
        // Renaming keeps its projects attached.
        await client.query(
            `UPDATE departments SET code = 'CSE', name = 'Computer Science and Engineering'
             WHERE institute_id = $1 AND code = 'COMP'
               AND NOT EXISTS (SELECT 1 FROM departments WHERE institute_id = $1 AND code = 'CSE')`,
            [instituteIds.KLE]
        );

        // Departments (3 per institute)
        const departmentIds = {}; // key: `${instituteCode}:${deptCode}`
        for (const code of Object.keys(instituteIds)) {
            for (const dept of departmentsOf(code)) {
                const { rows } = await client.query(
                    `INSERT INTO departments (institute_id, code, name) VALUES ($1,$2,$3)
                     ON CONFLICT (institute_id, code) DO UPDATE SET name = EXCLUDED.name
                     RETURNING id, code`,
                    [instituteIds[code], dept.code, dept.name]
                );
                departmentIds[`${code}:${dept.code}`] = rows[0].id;
            }
        }
        console.log('Departments seeded:', Object.keys(departmentIds).length);

        // Demo users
        const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
        const DEMO_USERS = [
            { email: 'platform.admin@apnileap.org', name: 'Platform Administrator', role: 'PLATFORM_ADMIN' },
            { email: 'programme.leader@apnileap.org', name: 'Balaji (Global Programme Leader)', role: 'GLOBAL_PROGRAMME_LEADER' },
            { email: 'kle.admin@apnileap.org', name: 'KLE Institute Administrator', role: 'INSTITUTE_ADMIN', institute: 'KLE' },
            { email: 'kle.mentor@apnileap.org', name: 'Faculty Mentor (KLE - CSE)', role: 'FACULTY_MENTOR', institute: 'KLE' },
            { email: 'kle.dean@apnileap.org', name: 'Dean (KLE)', role: 'DEAN_PRINCIPAL', institute: 'KLE' },
            { email: 'kle.hod.cse@apnileap.org', name: 'Head, Computer Science and Engineering (KLE)', role: 'DEPARTMENT_HEAD', institute: 'KLE' },
            { email: 'kle.hod.cseai@apnileap.org', name: 'Head, Computer Science and Engineering (AI) (KLE)', role: 'DEPARTMENT_HEAD', institute: 'KLE' },
            { email: 'kle.reviewer@apnileap.org', name: 'Reviewer/Success Coach (KLE)', role: 'REVIEWER', institute: 'KLE' },
            { email: 'kle.readonly@apnileap.org', name: 'Read-only Stakeholder (KLE)', role: 'READ_ONLY_STAKEHOLDER', institute: 'KLE' },
        ];

        const userIds = {};
        for (const u of DEMO_USERS) {
            const { rows } = await client.query(
                `INSERT INTO users (email, password_hash, full_name) VALUES ($1,$2,$3)
                 ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
                 RETURNING id, email`,
                [u.email, passwordHash, u.name]
            );
            userIds[u.email] = rows[0].id;

            await client.query(
                `INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)
                 ON CONFLICT (user_id, role_id) DO NOTHING`,
                [rows[0].id, roleIds[u.role]]
            );

            if (u.role === 'PLATFORM_ADMIN' || u.role === 'GLOBAL_PROGRAMME_LEADER') {
                for (const code of Object.keys(instituteIds)) {
                    await client.query(
                        `INSERT INTO user_institute_access (user_id, institute_id) VALUES ($1,$2)
                         ON CONFLICT DO NOTHING`,
                        [rows[0].id, instituteIds[code]]
                    );
                }
            } else if (u.institute) {
                await client.query(
                    `INSERT INTO user_institute_access (user_id, institute_id) VALUES ($1,$2)
                     ON CONFLICT DO NOTHING`,
                    [rows[0].id, instituteIds[u.institute]]
                );
            }
        }
        console.log('Demo users seeded:', Object.keys(userIds).length);

        // ---- KLE departments, their Heads, and the Dean's department access ----
        for (const d of KLE_EXTRA_DEPARTMENTS) {
            // The second CSE department is created here; CSE already exists above.
            if (d.name) {
                const { rows } = await client.query(
                    `INSERT INTO departments (institute_id, code, name) VALUES ($1,$2,$3)
                     ON CONFLICT (institute_id, code) DO UPDATE SET name = EXCLUDED.name
                     RETURNING id`,
                    [instituteIds.KLE, d.code, d.name]
                );
                departmentIds[`KLE:${d.code}`] = rows[0].id;
            }
            const deptId = departmentIds[`KLE:${d.code}`];
            await client.query(`UPDATE departments SET head_user_id = $1 WHERE id = $2`, [userIds[d.headEmail], deptId]);
            for (const email of [d.headEmail, KLE_DEAN_EMAIL]) {
                await client.query(
                    `INSERT INTO user_department_access (user_id, department_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
                    [userIds[email], deptId]
                );
            }
        }
        console.log('KLE departments with Head and Dean access seeded:', KLE_EXTRA_DEPARTMENTS.length);

        // Seed themes for each department
        const sampleThemeNames = [
            'Smart Education & Learning Systems',
            'Sustainable Campus & Smart Energy',
            'Healthcare & Medical AI',
            'Autonomous Robotics & Automation'
        ];
        const themeMap = {};
        for (const deptKey of Object.keys(departmentIds)) {
            if (deptKey === 'KLE:CSEAI') continue; // Handled separately with real department themes below
            const deptId = departmentIds[deptKey];
            for (const tName of sampleThemeNames) {
                const { rows: tRows } = await client.query(
                    `INSERT INTO themes (department_id, name, description)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (department_id, name) DO UPDATE SET description = EXCLUDED.description
                     RETURNING id`,
                    [deptId, tName, `Projects and innovations focused on ${tName}`]
                );
                themeMap[`${deptId}:${tName}`] = tRows[0].id;
            }
        }
        console.log('Themes seeded across departments.');

        // Sample projects with a spread of RAG statuses across institutes/departments
        const RAG_CYCLE = ['GREEN', 'GREEN', 'YELLOW', 'GREEN', 'RED', 'YELLOW', 'GREEN', 'GREEN', 'RED', 'YELLOW'];
        let ragIdx = 0;
        let projectSeq = 1;
        const mentorId = userIds['kle.mentor@apnileap.org'];

        for (const instCode of Object.keys(instituteIds)) {
            for (const { code: deptCode, name: deptName } of departmentsOf(instCode)) {
                const deptId = departmentIds[`${instCode}:${deptCode}`];

                // 2 projects per theme for each department
                for (let tIdx = 0; tIdx < sampleThemeNames.length; tIdx++) {
                    const assignedThemeName = sampleThemeNames[tIdx];
                    const assignedThemeId = themeMap[`${deptId}:${assignedThemeName}`];
                    for (let i = 0; i < 2; i++) {
                        const rag = RAG_CYCLE[ragIdx % RAG_CYCLE.length];
                        ragIdx++;
                        const code = `AL-${instCode}-${String(projectSeq).padStart(3, '0')}`;
                        projectSeq++;
                        const completion = rag === 'RED' ? 30 : rag === 'YELLOW' ? 55 : 78;

                        const { rows } = await client.query(
                            `INSERT INTO projects
                                (project_code, title, institute_id, department_id, mentor_user_id,
                                 academic_year, semester, rag_status, completion_pct,
                                 last_review_at, next_review_at, project_phase, created_by, theme_id, theme_name)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - interval '10 days', now() + interval '7 days', 'ACTIVE', $5, $10, $11)
                             ON CONFLICT (project_code) DO UPDATE SET title = EXCLUDED.title, theme_id = EXCLUDED.theme_id, theme_name = EXCLUDED.theme_name
                             RETURNING id, (xmax = 0) AS inserted`,
                            [code, `${assignedThemeName} Project ${i + 1}`, instituteIds[instCode], deptId, instCode === 'KLE' ? mentorId : null,
                             '2026-27', 'Sem-5', rag, completion, assignedThemeId, assignedThemeName]
                        );

                        // Only for newly created rows, so re-running the seed does not
                        // pile up duplicate history entries.
                        if (rows[0].inserted) {
                            await client.query(
                                `INSERT INTO status_history (project_id, previous_status, new_status, reason, changed_by)
                                 VALUES ($1, NULL, $2, 'Initial status at project creation', $3)`,
                                [rows[0].id, rag, mentorId]
                            );
                        }
                    }
                }
            }
        }
        console.log('Sample projects seeded:', projectSeq - 1);

        // KLE CSEAI: Seed real student teams, themes, and faculty guides
        const cseaiId = departmentIds['KLE:CSEAI'];
        const cseaiDataPath = path.join(__dirname, 'data', 'cseai_teams.json');
        if (require('fs').existsSync(cseaiDataPath)) {
            const cseaiTeams = JSON.parse(require('fs').readFileSync(cseaiDataPath, 'utf8'));
            console.log(`Loading ${cseaiTeams.length} real CSEAI teams from cseai_teams.json...`);

            // 1. Seed CSEAI themes
            const uniqueThemes = [...new Set(cseaiTeams.map((t) => t.theme).filter(Boolean))];
            for (const tName of uniqueThemes) {
                const { rows } = await client.query(
                    `INSERT INTO themes (department_id, name, description)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (department_id, name) DO UPDATE SET name = EXCLUDED.name
                     RETURNING id, name`,
                    [cseaiId, tName, `Mini-project innovations focused on ${tName}`]
                );
                themeMap[`${cseaiId}:${tName}`] = rows[0].id;
            }

            // Remove any legacy empty themes for CSEAI
            await client.query(
                `DELETE FROM themes WHERE department_id = $1 AND NOT (name = ANY($2::text[]))`,
                [cseaiId, uniqueThemes]
            );

            // 2. Seed CSEAI Faculty Guides / Mentors
            const guideEmailHelper = (name) => {
                const parts = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/);
                if (parts.length === 1) return `${parts[0]}@apnileap.org`;
                return `${parts[0]}.${parts[parts.length - 1]}@apnileap.org`;
            };

            const cseaiMentorMap = {};
            const { rows: existingMentors } = await client.query(
                `SELECT u.id, u.full_name, u.email FROM users u 
                 JOIN user_roles ur ON u.id = ur.user_id 
                 WHERE ur.role_id = $1`,
                [roleIds['FACULTY_MENTOR']]
            );
            existingMentors.forEach((m) => {
                cseaiMentorMap[m.full_name.trim().toLowerCase()] = m.id;
            });

            const uniqueGuides = [...new Set(cseaiTeams.map((t) => t.guideClean).filter(Boolean))];
            for (const gName of uniqueGuides) {
                const key = gName.toLowerCase();
                const foundKey = Object.keys(cseaiMentorMap).find((k) => k.includes(key) || key.includes(k));
                if (foundKey) {
                    cseaiMentorMap[key] = cseaiMentorMap[foundKey];
                    continue;
                }

                const gEmail = guideEmailHelper(gName);
                const { rows: uRows } = await client.query(
                    `INSERT INTO users (email, password_hash, full_name)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
                     RETURNING id`,
                    [gEmail, passwordHash, gName]
                );
                const mentorUserId = uRows[0].id;
                cseaiMentorMap[key] = mentorUserId;

                await client.query(
                    `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [mentorUserId, roleIds['FACULTY_MENTOR']]
                );
                await client.query(
                    `INSERT INTO user_institute_access (user_id, institute_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [mentorUserId, instituteIds.KLE]
                );
                await client.query(
                    `INSERT INTO user_department_access (user_id, department_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [mentorUserId, cseaiId]
                );
            }

            // Clear existing students in CSEAI before re-inserting to prevent unique constraint collisions
            await client.query(`DELETE FROM project_students WHERE project_id IN (SELECT id FROM projects WHERE department_id = $1)`, [cseaiId]);

            // 3. Seed Projects & Students
            const specialCodeMap = {
                'B14': 'AL-KLE-023',
                'B13': 'AL-KLE-024',
                'B11': 'AL-KLE-025',
                'A1': 'AL-KLE-003',
                'A2': 'AL-KLE-004',
            };
            let nextSeq = 26;

            for (const team of cseaiTeams) {
                let projectCode = specialCodeMap[team.teamNo];
                if (!projectCode) {
                    projectCode = `AL-KLE-${String(nextSeq).padStart(3, '0')}`;
                    nextSeq++;
                }

                const mentorIdVal = cseaiMentorMap[team.guideClean.toLowerCase()] || null;
                const themeIdVal = themeMap[`${cseaiId}:${team.theme}`] || null;
                const rag = RAG_CYCLE[ragIdx % RAG_CYCLE.length];
                ragIdx++;
                const compPct = rag === 'RED' ? 35 : (rag === 'YELLOW' ? 60 : 82);

                const { rows: existingProj } = await client.query(
                    `SELECT id FROM projects WHERE project_code = $1`,
                    [projectCode]
                );

                let projectId;
                if (existingProj.length) {
                    projectId = existingProj[0].id;
                    await client.query(
                        `UPDATE projects
                         SET title = $1, theme_id = $2, theme_name = $3, mentor_user_id = $4, faculty_mentor_name = $5,
                             team_id = $6, artefact_title = $1, department_id = $7, institute_id = $8, is_active = TRUE,
                             rag_status = COALESCE(rag_status, $9), completion_pct = COALESCE(completion_pct, $10)
                         WHERE id = $11`,
                        [team.title, themeIdVal, team.theme, mentorIdVal, team.guideClean, team.teamNo, cseaiId, instituteIds.KLE, rag, compPct, projectId]
                    );
                } else {
                    const { rows: newProj } = await client.query(
                        `INSERT INTO projects (
                             project_code, title, institute_id, department_id, mentor_user_id, faculty_mentor_name,
                             academic_year, semester, rag_status, completion_pct, project_phase, is_active,
                             theme_id, theme_name, team_id, artefact_title, last_review_at, next_review_at
                         ) VALUES (
                             $1, $2, $3, $4, $5, $6, '2026-27', 'Sem-5', $7, $8, 'ACTIVE', TRUE,
                             $9, $10, $11, $2, now() - interval '10 days', now() + interval '7 days'
                         ) RETURNING id`,
                        [projectCode, team.title, instituteIds.KLE, cseaiId, mentorIdVal, team.guideClean, rag, compPct, themeIdVal, team.theme, team.teamNo]
                    );
                    projectId = newProj[0].id;
                }

                for (const s of team.students) {
                    await client.query(
                        `INSERT INTO project_students (project_id, slot, name, srn, semester, division)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         ON CONFLICT (project_id, slot) DO UPDATE
                             SET name     = EXCLUDED.name,
                                 srn      = EXCLUDED.srn,
                                 semester = EXCLUDED.semester,
                                 division = EXCLUDED.division`,
                        [projectId, s.slot, s.name, s.srn, s.semester, s.division]
                    );
                }
            }
            console.log(`Seeded ${cseaiTeams.length} real CSEAI teams and student rosters.`);
        }

        // Every project has exactly four students: give any project without a
        // team a demo one (projects that already have a team are left alone).
        const { rows: teamless } = await client.query(
            `SELECT p.id FROM projects p
             WHERE NOT EXISTS (SELECT 1 FROM project_students s WHERE s.project_id = p.id)
             ORDER BY p.project_code`
        );
        let teamSeed = 0;
        const { rows: maxSrnRows } = await client.query(
            `SELECT COALESCE(MAX(NULLIF(regexp_replace(srn, '^01FE23BCS', ''), '')::int), 99) AS max_srn
             FROM project_students WHERE srn LIKE '01FE23BCS%'`
        );
        const maxSrnVal = Number(maxSrnRows[0].max_srn);
        if (maxSrnVal >= 100) {
            teamSeed = Math.floor((maxSrnVal - 100) / 4) + 1;
        }

        for (const { id } of teamless) {
            for (const s of demoTeam(teamSeed)) {
                await client.query(
                    `INSERT INTO project_students (project_id, slot, name, srn, semester, division)
                     VALUES ($1,$2,$3,$4,$5,$6)
                     ON CONFLICT DO NOTHING`,
                    [id, s.slot, s.name, s.srn, s.semester, s.division]
                );
            }
            teamSeed++;
        }
        // Show the mentor's name on projects that have a mentor account.
        await client.query(
            `UPDATE projects p SET faculty_mentor_name = u.full_name
             FROM users u WHERE u.id = p.mentor_user_id AND p.faculty_mentor_name IS NULL`
        );
        // Team ID / Artefact ID are assigned by the database; give demo projects an artefact title.
        await client.query(`UPDATE projects SET artefact_title = title WHERE artefact_title IS NULL`);
        // Every student on a team can sign in with their SRN (default password).
        const { rows: teamStudents } = await client.query(`SELECT DISTINCT ON (srn) srn, name FROM project_students ORDER BY srn, created_at DESC`);
        const studentLogins = await ensureStudentAccounts(client, teamStudents);
        console.log('Student logins created:', studentLogins);
        console.log('Demo student teams created for', teamless.length, 'projects');

        // 4. Seed Jira Board Links for ALL projects
        const { rows: allProjs } = await client.query(`SELECT id, project_code FROM projects`);
        for (const p of allProjs) {
            let key = (p.project_code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            if (!key || !/^[A-Z]/.test(key)) key = `AL${key}`.slice(0, 10);
            else key = key.slice(0, 10);
            const { rows: existing } = await client.query(
                `SELECT id FROM jira_links WHERE project_id = $1 AND link_type = 'JIRA_PROJECT'`,
                [p.id]
            );
            if (!existing.length) {
                await client.query(
                    `INSERT INTO jira_links (project_id, jira_issue_key, jira_issue_id, link_type)
                     VALUES ($1, $2, $2, 'JIRA_PROJECT')`,
                    [p.id, key]
                );
            }
        }
        console.log(`Jira integration links seeded for ${allProjs.length} projects.`);


        // 5. Seed default KPIs for AL-KLE-023 and AL-KLE-026
        const defaultKpis = [
            { code: 'AL-KLE-023', name: 'End-to-End Streaming Latency', target: '50', unit: 'ms' },
            { code: 'AL-KLE-023', name: 'Buffer Underflow Rate', target: '1', unit: '%' },
            { code: 'AL-KLE-023', name: 'Frame Rendering Throughput', target: '60', unit: 'fps' },
            { code: 'AL-KLE-026', name: 'Model Inference & System Latency', target: '50', unit: 'ms' },
            { code: 'AL-KLE-026', name: 'Pipeline Throughput & Reliability', target: '99', unit: '%' },
            { code: 'AL-KLE-026', name: 'Test Coverage & Validation Accuracy', target: '85', unit: '%' },
        ];
        for (const k of defaultKpis) {
            const { rows: pRows } = await client.query(`SELECT id FROM projects WHERE project_code = $1`, [k.code]);
            if (pRows.length) {
                const pid = pRows[0].id;
                const { rows: existing } = await client.query(
                    `SELECT id FROM kpis WHERE project_id = $1 AND name = $2`,
                    [pid, k.name]
                );
                if (!existing.length) {
                    await client.query(
                        `INSERT INTO kpis (project_id, name, target_value, unit)
                         VALUES ($1, $2, $3, $4)`,
                        [pid, k.name, k.target, k.unit]
                    );
                }
            }
        }
        console.log('Default KPIs seeded.');

        // 6. Seed default Milestones for AL-KLE-023 and AL-KLE-026
        const defaultMilestones = [
            { code: 'AL-KLE-023', title: 'Architecture & Protocol Specification', status: 'COMPLETED', daysDue: -15 },
            { code: 'AL-KLE-023', title: 'Core Buffer Optimization Engine Prototype', status: 'IN_PROGRESS', daysDue: 14 },
            { code: 'AL-KLE-023', title: 'End-to-End Latency Benchmarking & Evaluation', status: 'UPCOMING', daysDue: 30 },
            { code: 'AL-KLE-026', title: 'Resource Telemetry & Sensor Integration', status: 'COMPLETED', daysDue: -12 },
            { code: 'AL-KLE-026', title: 'Dynamic Scheduling & Allocation Engine', status: 'IN_PROGRESS', daysDue: 10 },
            { code: 'AL-KLE-026', title: 'Multi-Tenant Lab Deployment & Stress Testing', status: 'UPCOMING', daysDue: 28 },
        ];
        for (const m of defaultMilestones) {
            const { rows: pRows } = await client.query(`SELECT id FROM projects WHERE project_code = $1`, [m.code]);
            if (pRows.length) {
                const pid = pRows[0].id;
                const { rows: existing } = await client.query(
                    `SELECT id FROM milestones WHERE project_id = $1 AND title = $2`,
                    [pid, m.title]
                );
                if (!existing.length) {
                    await client.query(
                        `INSERT INTO milestones (project_id, title, status, due_date)
                         VALUES ($1, $2, $3, (now() + ($4 || ' days')::interval)::date)`,
                        [pid, m.title, m.status, m.daysDue]
                    );
                }
            }
        }
        console.log('Default milestones seeded.');

        // 7. Seed default Challenges (Issues) & Corrective Actions
        const defaultChallenges = [
            {
                code: 'AL-KLE-023',
                title: 'Dataset preprocessing memory overflow during batch training',
                rootCause: 'Batch loading large uncompressed video frames exceeds host RAM',
                impact: 'Training process crashes during epoch transition',
                supportRequired: 'High-memory compute nodes or chunk streaming loaders',
                status: 'IN_PROGRESS',
                actionDesc: 'Implement streaming chunk reader with PyTorch DataLoader generators',
                actionOwner: 'Aarav Kulkarni',
            },
            {
                code: 'AL-KLE-026',
                title: 'High GPU contention during multi-tenant model inferencing',
                rootCause: 'Concurrent client inference requests without queuing mechanism',
                impact: 'Latency spikes exceed the 50ms SLA requirement',
                supportRequired: 'Configuration of Triton inference server dynamic batching',
                status: 'OPEN',
                actionDesc: 'Deploy dynamic batching with Triton inference server to throttle request spikes',
                actionOwner: 'KLE Student Lead',
            }
        ];
        for (const ch of defaultChallenges) {
            const { rows: pRows } = await client.query(`SELECT id FROM projects WHERE project_code = $1`, [ch.code]);
            if (pRows.length) {
                const pid = pRows[0].id;
                const { rows: existing } = await client.query(
                    `SELECT id FROM issues WHERE project_id = $1 AND title = $2`,
                    [pid, ch.title]
                );
                let issueId;
                if (!existing.length) {
                    const { rows: inserted } = await client.query(
                        `INSERT INTO issues (project_id, title, root_cause, impact, support_required, status)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         RETURNING id`,
                        [pid, ch.title, ch.rootCause, ch.impact, ch.supportRequired, ch.status]
                    );
                    issueId = inserted[0].id;
                } else {
                    issueId = existing[0].id;
                }

                if (ch.actionDesc) {
                    const { rows: existingAct } = await client.query(
                        `SELECT id FROM corrective_actions WHERE issue_id = $1 AND description = $2`,
                        [issueId, ch.actionDesc]
                    );
                    if (!existingAct.length) {
                        await client.query(
                            `INSERT INTO corrective_actions (issue_id, project_id, description, owner_name, due_date, status)
                             VALUES ($1, $2, $3, $4, (now() + interval '7 days')::date, 'OPEN')`,
                            [issueId, pid, ch.actionDesc, ch.actionOwner]
                        );
                    }
                }
            }
        }
        // Realign sequences so that new project creation via UI / API does not collide
        await client.query(`
            SELECT setval('artefact_id_seq', GREATEST(COALESCE((SELECT MAX((regexp_match(artefact_id, '\\d+'))[1]::int) FROM projects), 200), 200), true);
            SELECT setval('team_id_seq', GREATEST(COALESCE((SELECT MAX((regexp_match(team_id, '\\d+'))[1]::int), 200), 200), true);
        `);
        console.log('Database sequences aligned.');

        await client.query('COMMIT');
        console.log('\nSeed complete.');
        console.log('Demo login password for all seeded users:', DEMO_PASSWORD);
        console.log('Accounts: ' + DEMO_USERS.map((u) => u.email).join(' / '));
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Seed failed:', err);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

seed();
