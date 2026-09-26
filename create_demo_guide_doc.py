import os
import sys
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, KeepTogether
from reportlab.lib import colors

BASE_DIR = r"C:\Users\Nupur\ApniLeap"
DOCX_PATH = os.path.join(BASE_DIR, "ApniLeap_Demo_Guide_and_Credentials.docx")
PDF_PATH = os.path.join(BASE_DIR, "ApniLeap_Demo_Guide_and_Credentials.pdf")

# Styling helper functions for docx
def set_cell_background(cell, hex_color):
    shading_elm = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>')
    cell._tc.get_or_add_tcPr().append(shading_elm)

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = OxmlElement('w:tcMar')
    for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        node = OxmlElement(f'w:{m}')
        node.set(qn('w:w'), str(val))
        node.set(qn('w:type'), 'dxa')
        tcMar.append(node)
    tcPr.append(tcMar)

def style_table_header(row, col_colors=None, hex_color="1A365D"):
    for cell in row.cells:
        set_cell_background(cell, hex_color)
        set_cell_margins(cell, 120, 120, 160, 160)
        for p in cell.paragraphs:
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            for run in p.runs:
                run.font.bold = True
                run.font.color.rgb = RGBColor(255, 255, 255)
                run.font.size = Pt(9.5)
                run.font.name = "Calibri"

def style_table_row(row, is_alt=False):
    bg_color = "F7FAFC" if is_alt else "FFFFFF"
    for cell in row.cells:
        set_cell_background(cell, bg_color)
        set_cell_margins(cell, 90, 90, 140, 140)
        for p in cell.paragraphs:
            for run in p.runs:
                run.font.size = Pt(9)
                run.font.name = "Calibri"

def generate_docx():
    doc = Document()

    # Page Margins
    sections = doc.sections
    for section in sections:
        section.top_margin = Inches(0.7)
        section.bottom_margin = Inches(0.7)
        section.left_margin = Inches(0.75)
        section.right_margin = Inches(0.75)

    # Document Header / Banner
    p_title = doc.add_paragraph()
    r_title = p_title.add_run("ApniLeap Mini-Project Portfolio Portal")
    r_title.font.name = "Calibri"
    r_title.font.size = Pt(22)
    r_title.font.bold = True
    r_title.font.color.rgb = RGBColor(26, 54, 93) # Navy blue

    p_sub = doc.add_paragraph()
    r_sub = p_sub.add_run("Demo Credentials, Project Creation & Dashboard Input Guide")
    r_sub.font.name = "Calibri"
    r_sub.font.size = Pt(13)
    r_sub.font.color.rgb = RGBColor(49, 130, 206) # Medium blue

    p_meta = doc.add_paragraph()
    r_meta = p_meta.add_run("Portal URL: http://localhost:4000  |  Jira Cloud: https://apnileap-portfolio.atlassian.net  |  Default Password: Demo@12345")
    r_meta.font.name = "Calibri"
    r_meta.font.size = Pt(9.5)
    r_meta.font.italic = True
    r_meta.font.color.rgb = RGBColor(113, 128, 150)

    doc.add_paragraph().paragraph_format.space_after = Pt(6)

    # Section 1: User Accounts & Credentials
    h1 = doc.add_heading(level=1)
    r_h1 = h1.add_run("1. Institutional User Accounts & Demo Credentials")
    r_h1.font.color.rgb = RGBColor(26, 54, 93)

    p_role_desc = doc.add_paragraph("All pre-configured user accounts are initialized with the standard password: ")
    r_pwd = p_role_desc.add_run("Demo@12345")
    r_pwd.font.bold = True
    r_pwd.font.color.rgb = RGBColor(197, 48, 48)

    cred_table = doc.add_table(rows=1, cols=4)
    cred_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = cred_table.rows[0]
    hdr.cells[0].paragraphs[0].text = "Role"
    hdr.cells[1].paragraphs[0].text = "Login Email"
    hdr.cells[2].paragraphs[0].text = "Password"
    hdr.cells[3].paragraphs[0].text = "Key Permissions & Access Scope"
    style_table_header(hdr)

    users_data = [
        ("Platform Administrator", "admin@apnileap.org", "Demo@12345", "Global governance, cross-institutional oversight, user & policy management."),
        ("Global Programme Leader", "gpl@apnileap.org", "Demo@12345", "High-level cross-institute portfolio drilldowns and status reviews."),
        ("Dean / Principal (KLE)", "kle.dean@apnileap.org", "Demo@12345", "Institutional portfolio reviews, RAG governance approval, project creation across all departments."),
        ("Head of Dept - CSE (AI)", "kle.hod.cseai@apnileap.org", "Demo@12345", "CSE-AI department project creation, mentor allocation, review approvals."),
        ("Head of Dept - CSE", "kle.hod.cse@apnileap.org", "Demo@12345", "CSE department project creation, mentor reviews, portfolio governance."),
        ("Faculty Mentor / Guide", "sujata.kotabagi@kletech.ac.in", "Demo@12345", "Mentored projects, milestone & KPI updates, challenge resolution, Kanban management."),
        ("Student Account", "01fe23bcs001@kletech.ac.in", "Demo@12345", "Read/write project workspace, task movement, challenge reporting, evidence submission.")
    ]

    for idx, (role, email, pwd, scope) in enumerate(users_data):
        row = cred_table.add_row()
        row.cells[0].paragraphs[0].text = role
        row.cells[1].paragraphs[0].text = email
        row.cells[2].paragraphs[0].text = pwd
        row.cells[3].paragraphs[0].text = scope
        style_table_row(row, is_alt=(idx % 2 == 1))

    doc.add_paragraph().paragraph_format.space_after = Pt(10)

    # Section 2: Instructions to Insert New Project
    h2 = doc.add_heading(level=1)
    r_h2 = h2.add_run("2. How Higher Authorities Insert a New Project")
    r_h2.font.color.rgb = RGBColor(26, 54, 93)

    steps = [
        ("Step 1: Sign in with a Governance Account", "Log in at http://localhost:4000 with kle.hod.cseai@apnileap.org or kle.dean@apnileap.org (Password: Demo@12345)."),
        ("Step 2: Navigate to Department & Theme", "Go to Departments -> Computer Science and Engineering (AI) -> Edge AI & Computer Vision (or any theme), then click '+ Add Project'."),
        ("Step 3: Enter Project & Team Details", "Fill in the project title, artefact title, mentor name, academic year, semester, and the 4 student team members (details provided below)."),
        ("Step 4: Save & Automated Jira Provisioning", "Click 'Save Project'. ApniLeap automatically creates the project, registers the Jira Cloud project, provisions a dedicated Kanban board, grants public authenticated permissions, and seeds starter tasks."),
        ("Step 5: Verify on Dashboard & Jira", "Click the '[🔷 Jira Kanban Board ↗]' button on the Project Dashboard or Workspace to see the live board on Jira Cloud with all tasks pre-populated.")
    ]

    for title, desc in steps:
        p_step = doc.add_paragraph()
        r_st = p_step.add_run(f"• {title}: ")
        r_st.font.bold = True
        r_st.font.color.rgb = RGBColor(43, 108, 176)
        p_step.add_run(desc)

    doc.add_paragraph().paragraph_format.space_after = Pt(10)

    # Section 3: Sample Demo Project Data
    h3 = doc.add_heading(level=1)
    r_h3 = h3.add_run("3. Ready-to-Copy Demo Project Input Data")
    r_h3.font.color.rgb = RGBColor(26, 54, 93)

    doc.add_paragraph("Use the following sample values to test the 'Add Project' form:")

    proj_table = doc.add_table(rows=1, cols=2)
    proj_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = proj_table.rows[0]
    hdr.cells[0].paragraphs[0].text = "Form Field"
    hdr.cells[1].paragraphs[0].text = "Input Value to Copy & Paste"
    style_table_header(hdr, hex_color="2C5282")

    p_fields = [
        ("Project Title", "Real-Time Edge AI Vision for Automated Defect Inspection"),
        ("Artefact Title", "Automated Industrial Vision Defect Inspector"),
        ("Academic Year", "2026-27"),
        ("Semester", "Sem-5"),
        ("Faculty Mentor", "Dr. Sujata Kotabagi"),
        ("Department", "Computer Science and Engineering (AI)"),
        ("Theme", "Edge AI & Computer Vision"),
        ("Student 1 (Lead)", "Aditya Kulkarni | SRN: 01FE23BCS951 | Div: A | Sem: Sem-5"),
        ("Student 2", "Pooja Patil | SRN: 01FE23BCS952 | Div: A | Sem: Sem-5"),
        ("Student 3", "Siddharth Joshi | SRN: 01FE23BCS953 | Div: A | Sem: Sem-5"),
        ("Student 4", "Sneha Hegde | SRN: 01FE23BCS954 | Div: A | Sem: Sem-5")
    ]

    for idx, (fld, val) in enumerate(p_fields):
        row = proj_table.add_row()
        row.cells[0].paragraphs[0].text = fld
        row.cells[1].paragraphs[0].text = val
        style_table_row(row, is_alt=(idx % 2 == 1))

    doc.add_paragraph().paragraph_format.space_after = Pt(10)

    # Section 4: Sample Challenges & Corrective Actions
    h4 = doc.add_heading(level=1)
    r_h4 = h4.add_run("4. Sample Challenges & Corrective Actions (For Dashboard Input)")
    r_h4.font.color.rgb = RGBColor(26, 54, 93)

    doc.add_paragraph("Navigate to Project Tracking -> Challenges & Actions tab in the project dashboard, click '+ Log Challenge', and paste any of the following items:")

    challenges_data = [
        {
            "num": "Challenge 1",
            "title": "GPU memory allocation exhaustion during high-resolution batch training",
            "root_cause": "Full-resolution uncompressed video frames loaded simultaneously into host VRAM without streaming DataLoader buffers.",
            "impact": "Training process crashes unexpectedly during epoch transitions, stalling model convergence.",
            "support": "Lab administrator access to configure PyTorch CUDA memory caching allocator and high-capacity RAM node.",
            "status": "IN_PROGRESS",
            "action": "Implement chunk-based streaming data loader using PyTorch IterableDataset and dynamic batch resizing.",
            "owner": "Aditya Kulkarni",
            "due": "7 days from today"
        },
        {
            "num": "Challenge 2",
            "title": "Multi-tenant model inferencing latency exceeding 50ms real-time SLA threshold",
            "root_cause": "Concurrent inspection requests queue up on a single GPU stream without dynamic request batching.",
            "impact": "Production line defect detection lags behind conveyor belt speed, risking uninspected components.",
            "support": "Provisioning Triton Inference Server instance with NVIDIA TensorRT runtime acceleration.",
            "status": "OPEN",
            "action": "Deploy Triton dynamic batching scheduler to coalesce inference requests into micro-batches of 8.",
            "owner": "Pooja Patil",
            "due": "5 days from today"
        },
        {
            "num": "Challenge 3",
            "title": "Severe class imbalance in defect dataset yielding elevated false-negative rates",
            "root_cause": "Historical factory dataset contains over 98% non-defective samples, skewing classifier decision boundaries.",
            "impact": "Critical surface micro-cracks fail detection criteria during automated inspection rounds.",
            "support": "Faculty mentor review of synthetic augmentation techniques (CycleGAN / Diffusion models).",
            "status": "OPEN",
            "action": "Apply Focal Loss optimization function and generate 500 synthetic defect samples via Albumentations pipeline.",
            "owner": "Siddharth Joshi",
            "due": "10 days from today"
        }
    ]

    for ch in challenges_data:
        p_c = doc.add_paragraph()
        r_c = p_c.add_run(f"[{ch['num']}] {ch['title']}")
        r_c.font.bold = True
        r_c.font.size = Pt(11)
        r_c.font.color.rgb = RGBColor(197, 48, 48)

        tbl = doc.add_table(rows=1, cols=2)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        hdr = tbl.rows[0]
        hdr.cells[0].paragraphs[0].text = "Field"
        hdr.cells[1].paragraphs[0].text = "Content to Paste"
        style_table_header(hdr, hex_color="742A2A")

        fields = [
            ("Challenge Title", ch["title"]),
            ("Root Cause", ch["root_cause"]),
            ("Academic/System Impact", ch["impact"]),
            ("Support Required", ch["support"]),
            ("Initial Status", ch["status"]),
            ("Corrective Action Plan", ch["action"]),
            ("Action Owner", ch["owner"]),
            ("Target Due Date", ch["due"])
        ]
        for idx, (f, v) in enumerate(fields):
            row = tbl.add_row()
            row.cells[0].paragraphs[0].text = f
            row.cells[1].paragraphs[0].text = v
            style_table_row(row, is_alt=(idx % 2 == 1))

        doc.add_paragraph().paragraph_format.space_after = Pt(6)

    doc.add_paragraph().paragraph_format.space_after = Pt(10)

    # Section 5: Sample KPIs & Measurements
    h5 = doc.add_heading(level=1)
    r_h5 = h5.add_run("5. Sample Key Performance Indicators (KPIs) & Measurements")
    r_h5.font.color.rgb = RGBColor(26, 54, 93)

    doc.add_paragraph("Navigate to Project Tracking -> KPIs tab in the project dashboard, click '+ Add KPI', and enter these quantitative engineering metrics:")

    kpi_data = [
        {
            "num": "KPI 1",
            "name": "End-to-End Defect Detection Latency",
            "target": "45",
            "unit": "ms",
            "desc": "Total duration elapsed from camera sensor frame capture through neural inference to defect classification trigger.",
            "measured": "38.2",
            "evidence": "NVIDIA TensorRT benchmark log on Jetson Orin Nano with batch size 1 across 1,000 continuous test frames."
        },
        {
            "num": "KPI 2",
            "name": "Mean Average Precision (mAP@0.50)",
            "target": "92.5",
            "unit": "%",
            "desc": "Object detection accuracy metric for surface scratch and crack localization validated on held-out test split.",
            "measured": "94.1",
            "evidence": "PyTorch evaluation script output evaluating 1,200 annotated ground-truth test images."
        },
        {
            "num": "KPI 3",
            "name": "Camera Ingestion Pipeline Throughput",
            "target": "60",
            "unit": "fps",
            "desc": "Sustained frames-per-second processed by OpenCV GStreamer hardware-accelerated video decoding pipe.",
            "measured": "62.4",
            "evidence": "GStreamer pipeline telemetry timestamps logged over 15 minutes of uninterrupted industrial camera stream."
        },
        {
            "num": "KPI 4",
            "name": "Edge Device Power Dissipation",
            "target": "15",
            "unit": "Watts",
            "desc": "Total thermal design power drawn by edge accelerator during maximum-load continuous inference loops.",
            "measured": "12.8",
            "evidence": "Hardware power meter telemetry reading via Jetson jtop power rail monitoring utility."
        }
    ]

    for k in kpi_data:
        p_k = doc.add_paragraph()
        r_k = p_k.add_run(f"[{k['num']}] {k['name']}")
        r_k.font.bold = True
        r_k.font.size = Pt(11)
        r_k.font.color.rgb = RGBColor(44, 82, 130)

        tbl = doc.add_table(rows=1, cols=2)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        hdr = tbl.rows[0]
        hdr.cells[0].paragraphs[0].text = "KPI Parameter"
        hdr.cells[1].paragraphs[0].text = "Value to Copy & Paste"
        style_table_header(hdr, hex_color="2B6CB0")

        fields = [
            ("KPI Name", k["name"]),
            ("Target Value", k["target"]),
            ("Unit", k["unit"]),
            ("Description", k["desc"]),
            ("Sample Measured Value (for measurement update)", k["measured"]),
            ("Verification Evidence Note", k["evidence"])
        ]
        for idx, (f, v) in enumerate(fields):
            row = tbl.add_row()
            row.cells[0].paragraphs[0].text = f
            row.cells[1].paragraphs[0].text = v
            style_table_row(row, is_alt=(idx % 2 == 1))

        doc.add_paragraph().paragraph_format.space_after = Pt(6)

    # Save DOCX
    doc.save(DOCX_PATH)
    print(f"Successfully generated Word document: {DOCX_PATH}")

def generate_pdf():
    doc = SimpleDocTemplate(
        PDF_PATH,
        pagesize=letter,
        leftMargin=40,
        rightMargin=40,
        topMargin=40,
        bottomMargin=40
    )

    styles = getSampleStyleSheet()

    # Custom styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=colors.HexColor('#1A365D'),
        spaceAfter=4
    )
    sub_style = ParagraphStyle(
        'DocSub',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=colors.HexColor('#3182CE'),
        spaceAfter=4
    )
    meta_style = ParagraphStyle(
        'DocMeta',
        parent=styles['Normal'],
        fontName='Helvetica-Oblique',
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor('#718096'),
        spaceAfter=14
    )
    h1_style = ParagraphStyle(
        'H1',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=17,
        textColor=colors.HexColor('#1A365D'),
        spaceBefore=12,
        spaceAfter=6
    )
    body_style = ParagraphStyle(
        'Body',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=11.5,
        textColor=colors.HexColor('#2D3748')
    )
    bold_body = ParagraphStyle(
        'BoldBody',
        parent=body_style,
        fontName='Helvetica-Bold'
    )
    tbl_hdr_style = ParagraphStyle(
        'TblHdr',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=11,
        textColor=colors.white
    )

    elements = []

    # Header
    elements.append(Paragraph("ApniLeap Mini-Project Portfolio Portal", title_style))
    elements.append(Paragraph("Demo Credentials, Project Creation & Dashboard Input Guide", sub_style))
    elements.append(Paragraph("Portal URL: http://localhost:4000  |  Jira Cloud: https://apnileap-portfolio.atlassian.net  |  Default Password: Demo@12345", meta_style))
    elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#CBD5E0'), spaceAfter=10))

    # Section 1: User Accounts & Credentials
    elements.append(Paragraph("1. Institutional User Accounts & Demo Credentials", h1_style))
    elements.append(Paragraph("All seeded accounts use password: <b><font color='#C53030'>Demo@12345</font></b>", body_style))
    elements.append(Spacer(1, 4))

    user_rows = [
        [Paragraph("Role", tbl_hdr_style), Paragraph("Login Email", tbl_hdr_style), Paragraph("Password", tbl_hdr_style), Paragraph("Key Scope & Permissions", tbl_hdr_style)],
        [Paragraph("<b>Platform Administrator</b>", body_style), Paragraph("admin@apnileap.org", body_style), Paragraph("Demo@12345", body_style), Paragraph("Full system config, policy, cross-institutional governance.", body_style)],
        [Paragraph("<b>Global Programme Leader</b>", body_style), Paragraph("gpl@apnileap.org", body_style), Paragraph("Demo@12345", body_style), Paragraph("Cross-institutional portfolio status & review oversight.", body_style)],
        [Paragraph("<b>Dean / Principal</b>", body_style), Paragraph("kle.dean@apnileap.org", body_style), Paragraph("Demo@12345", body_style), Paragraph("Institutional project oversight, RAG approvals, project creation.", body_style)],
        [Paragraph("<b>Head of Dept - CSEAI</b>", body_style), Paragraph("kle.hod.cseai@apnileap.org", body_style), Paragraph("Demo@12345", body_style), Paragraph("CSEAI project creation, mentor allocation, review approvals.", body_style)],
        [Paragraph("<b>Head of Dept - CSE</b>", body_style), Paragraph("kle.hod.cse@apnileap.org", body_style), Paragraph("Demo@12345", body_style), Paragraph("CSE department project creation, mentor reviews.", body_style)],
        [Paragraph("<b>Faculty Mentor</b>", body_style), Paragraph("sujata.kotabagi@kletech.ac.in", body_style), Paragraph("Demo@12345", body_style), Paragraph("Mentored projects, KPI & challenge updates, Kanban tasks.", body_style)],
        [Paragraph("<b>Student Account</b>", body_style), Paragraph("01fe23bcs001@kletech.ac.in", body_style), Paragraph("Demo@12345", body_style), Paragraph("Workspace access, task movement, challenge submission.", body_style)]
    ]
    t_users = Table(user_rows, colWidths=[120, 150, 75, 185])
    t_users.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1A365D')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#F7FAFC')]),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0'))
    ]))
    elements.append(t_users)
    elements.append(Spacer(1, 10))

    # Section 2: How to Insert New Project
    elements.append(Paragraph("2. How Higher Authorities Insert a New Project", h1_style))
    steps = [
        "<b>Step 1: Sign in with a Governance Account</b>: Log in at http://localhost:4000 with <code>kle.hod.cseai@apnileap.org</code> or <code>kle.dean@apnileap.org</code> (Password: <code>Demo@12345</code>).",
        "<b>Step 2: Navigate to Department & Theme</b>: Go to Departments -> Computer Science and Engineering (AI) -> Edge AI & Computer Vision, then click '+ Add Project'.",
        "<b>Step 3: Enter Project & Team Details</b>: Fill in the title, artefact title, mentor name, academic year, semester, and 4 student team members.",
        "<b>Step 4: Automatic Jira Cloud Provisioning</b>: Click 'Save Project'. ApniLeap automatically provisions the Jira project, creates the Kanban board with project location, shares filter permissions with all logged-in users, and seeds starter tasks.",
        "<b>Step 5: Verify on Dashboard & Jira</b>: Click '[🔷 Jira Kanban Board ↗]' on the Project Dashboard or Workspace to see the live board on Jira Cloud."
    ]
    for s in steps:
        elements.append(Paragraph(f"• {s}", body_style))
        elements.append(Spacer(1, 2))
    elements.append(Spacer(1, 10))

    # Section 3: Ready-to-Copy Demo Project Input Data
    elements.append(Paragraph("3. Ready-to-Copy Demo Project Input Data", h1_style))
    p_data = [
        [Paragraph("Form Field", tbl_hdr_style), Paragraph("Input Value to Copy & Paste", tbl_hdr_style)],
        [Paragraph("<b>Project Title</b>", body_style), Paragraph("Real-Time Edge AI Vision for Automated Defect Inspection", body_style)],
        [Paragraph("<b>Artefact Title</b>", body_style), Paragraph("Automated Industrial Vision Defect Inspector", body_style)],
        [Paragraph("<b>Academic Year</b>", body_style), Paragraph("2026-27", body_style)],
        [Paragraph("<b>Semester</b>", body_style), Paragraph("Sem-5", body_style)],
        [Paragraph("<b>Faculty Mentor</b>", body_style), Paragraph("Dr. Sujata Kotabagi", body_style)],
        [Paragraph("<b>Student 1 (Lead)</b>", body_style), Paragraph("Aditya Kulkarni | SRN: 01FE23BCS951 | Div: A | Sem: Sem-5", body_style)],
        [Paragraph("<b>Student 2</b>", body_style), Paragraph("Pooja Patil | SRN: 01FE23BCS952 | Div: A | Sem: Sem-5", body_style)],
        [Paragraph("<b>Student 3</b>", body_style), Paragraph("Siddharth Joshi | SRN: 01FE23BCS953 | Div: A | Sem: Sem-5", body_style)],
        [Paragraph("<b>Student 4</b>", body_style), Paragraph("Sneha Hegde | SRN: 01FE23BCS954 | Div: A | Sem: Sem-5", body_style)],
    ]
    t_proj = Table(p_data, colWidths=[140, 390])
    t_proj.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#2C5282')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#F7FAFC')]),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0'))
    ]))
    elements.append(t_proj)
    elements.append(Spacer(1, 10))

    # Section 4: Sample Challenges
    elements.append(Paragraph("4. Sample Challenges & Corrective Actions (For Dashboard Input)", h1_style))
    elements.append(Paragraph("Paste these items under <b>Project Tracking -> Challenges & Actions</b>:", body_style))
    elements.append(Spacer(1, 4))

    ch_items = [
        ("Challenge 1: GPU memory exhaustion during batch training",
         "Root Cause: Full-resolution uncompressed video frames loaded simultaneously into host VRAM.<br/>"
         "Impact: Training process crashes during epoch transitions.<br/>"
         "Support Required: Lab admin access to configure PyTorch CUDA memory allocator.<br/>"
         "Action: Implement streaming DataLoader using PyTorch IterableDataset and dynamic resizing.<br/>"
         "Owner: Aditya Kulkarni | Status: IN_PROGRESS | Due Date: 7 days from today"),
        ("Challenge 2: Multi-tenant model inference latency exceeding 50ms SLA",
         "Root Cause: Concurrent inspection requests queue on single GPU stream without dynamic batching.<br/>"
         "Impact: Factory defect detection lags behind conveyor belt speed.<br/>"
         "Support Required: Provision Triton Inference Server with NVIDIA TensorRT runtime.<br/>"
         "Action: Deploy Triton dynamic batch scheduler to coalesce requests into micro-batches of 8.<br/>"
         "Owner: Pooja Patil | Status: OPEN | Due Date: 5 days from today")
    ]
    for ch_t, ch_b in ch_items:
        t_ch = Table([
            [Paragraph(f"<b>{ch_t}</b>", tbl_hdr_style)],
            [Paragraph(ch_b, body_style)]
        ], colWidths=[530])
        t_ch.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#742A2A')),
            ('BACKGROUND', (0,1), (-1,1), colors.HexColor('#FFF5F5')),
            ('BOTTOMPADDING', (0,0), (-1,-1), 5),
            ('TOPPADDING', (0,0), (-1,-1), 5),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#FEB2B2'))
        ]))
        elements.append(t_ch)
        elements.append(Spacer(1, 6))

    # Section 5: Sample KPIs
    elements.append(Paragraph("5. Sample Key Performance Indicators (KPIs)", h1_style))
    elements.append(Paragraph("Paste these items under <b>Project Tracking -> KPIs</b>:", body_style))
    elements.append(Spacer(1, 4))

    kpi_rows = [
        [Paragraph("KPI Name", tbl_hdr_style), Paragraph("Target", tbl_hdr_style), Paragraph("Unit", tbl_hdr_style), Paragraph("Description & Sample Measurement", tbl_hdr_style)],
        [Paragraph("<b>Defect Detection Latency</b>", body_style), Paragraph("45", body_style), Paragraph("ms", body_style), Paragraph("Total camera-to-classification duration.<br/><b>Sample Measure:</b> 38.2 ms (TensorRT benchmark on Jetson Orin Nano).", body_style)],
        [Paragraph("<b>Mean Avg Precision (mAP@0.50)</b>", body_style), Paragraph("92.5", body_style), Paragraph("%", body_style), Paragraph("Scratch/crack detection accuracy.<br/><b>Sample Measure:</b> 94.1% on 1,200 annotated test images.", body_style)],
        [Paragraph("<b>Camera Throughput</b>", body_style), Paragraph("60", body_style), Paragraph("fps", body_style), Paragraph("GStreamer hardware-accelerated decoding.<br/><b>Sample Measure:</b> 62.4 fps continuous stream.", body_style)],
        [Paragraph("<b>Edge Device Power</b>", body_style), Paragraph("15", body_style), Paragraph("Watts", body_style), Paragraph("Maximum load power dissipation.<br/><b>Sample Measure:</b> 12.8 Watts via jtop telemetry.", body_style)]
    ]
    t_kpi = Table(kpi_rows, colWidths=[130, 45, 45, 310])
    t_kpi.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#2B6CB0')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#F7FAFC')]),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E0'))
    ]))
    elements.append(t_kpi)

    doc.build(elements)
    print(f"Successfully generated PDF document: {PDF_PATH}")

if __name__ == '__main__':
    generate_docx()
    generate_pdf()
