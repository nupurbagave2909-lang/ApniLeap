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
DOCX_PATH = os.path.join(BASE_DIR, "ApniLeap_Two_Projects_Demo_Credentials.docx")
PDF_PATH = os.path.join(BASE_DIR, "ApniLeap_Two_Projects_Demo_Credentials.pdf")
OLD_DOCX_PATH = os.path.join(BASE_DIR, "ApniLeap_Demo_Guide_and_Credentials.docx")
OLD_PDF_PATH = os.path.join(BASE_DIR, "ApniLeap_Demo_Guide_and_Credentials.pdf")

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
    for section in doc.sections:
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
    r_sub = p_sub.add_run("Demo Credentials, Project Creation & Dashboard Input Guide for Two New Projects")
    r_sub.font.name = "Calibri"
    r_sub.font.size = Pt(13)
    r_sub.font.color.rgb = RGBColor(49, 130, 206) # Medium blue

    p_meta = doc.add_paragraph()
    r_meta = p_meta.add_run("Portal URL: http://localhost:4000  |  Jira Cloud: https://apnileap-portfolio.atlassian.net  |  Default Password: Demo@12345")
    r_meta.font.name = "Calibri"
    r_meta.font.size = Pt(9.5)
    r_meta.font.italic = True
    r_meta.font.color.rgb = RGBColor(113, 128, 150)

    doc.add_paragraph().paragraph_format.space_after = Pt(4)

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
        ("Platform Administrator", "admin@apnileap.org", "Demo@12345", "Global governance, cross-institutional oversight, user management, unrestricted project creation."),
        ("Dean / Principal (KLE)", "kle.dean@apnileap.org", "Demo@12345", "Institutional oversight, RAG governance approval, project creation across all institute departments."),
        ("Head of Dept - CSE (AI)", "kle.hod.cseai@apnileap.org", "Demo@12345", "CSE-AI department project creation, mentor allocation, review approvals, workspace task actions."),
        ("Head of Dept - CSE", "kle.hod.cse@apnileap.org", "Demo@12345", "CSE department project creation, mentor reviews, portfolio governance, workspace task actions."),
        ("Faculty Mentor (CSE-AI)", "sujata.kotabagi@kletech.ac.in", "Demo@12345", "Assigned CSE-AI projects, milestone & KPI updates, challenge logging, Kanban management."),
        ("Faculty Mentor (CSE)", "amit.kachavimath@kletech.ac.in", "Demo@12345", "Assigned CSE projects, milestone & KPI updates, challenge resolution, Kanban management."),
        ("Student Account (Demo)", "01fe23bcs001@kletech.ac.in", "Demo@12345", "Student workspace view, Kanban card movement, challenge reporting, evidence submission.")
    ]

    for idx, (role, email, pwd, scope) in enumerate(users_data):
        row = cred_table.add_row()
        row.cells[0].paragraphs[0].text = role
        row.cells[1].paragraphs[0].text = email
        row.cells[2].paragraphs[0].text = pwd
        row.cells[3].paragraphs[0].text = scope
        style_table_row(row, is_alt=(idx % 2 == 1))

    doc.add_paragraph().paragraph_format.space_after = Pt(8)

    # Section 2: Instructions to Insert New Project
    h2 = doc.add_heading(level=1)
    r_h2 = h2.add_run("2. Step-by-Step Instructions to Insert a New Project")
    r_h2.font.color.rgb = RGBColor(26, 54, 93)

    steps = [
        ("Step 1: Sign in with a Governance Account", "Log in at http://localhost:4000 using kle.hod.cseai@apnileap.org, kle.hod.cse@apnileap.org, or kle.dean@apnileap.org (Password: Demo@12345)."),
        ("Step 2: Navigate to Target Department & Theme", "On the Dashboard, click on the appropriate Department (e.g., Computer Science and Engineering (AI) or Computer Science and Engineering), select the Theme, then click '+ Add Project'."),
        ("Step 3: Enter Project & Team Details", "Fill in Project Title, Artefact Title, Mentor Name, Academic Year (2026-27), Semester (Sem-5), and the 4 student team members from the tables below."),
        ("Step 4: Save & Automated Jira Provisioning", "Click 'Save Project'. ApniLeap automatically creates the project, provisions a dedicated Jira Cloud Kanban board, shares permissions with authenticated users, and seeds starter tasks and KPIs."),
        ("Step 5: Access Project Dashboard & Workspace", "Click 'Open →' or 'Project Workspace'. You will see the Jira Kanban board link [🔷 Jira Board ↗], interactive Kanban buttons (← To Do, In Progress →, Completed ✓), and clickable Jira issue hyperlinks on all KPIs and Challenges.")
    ]

    for title, desc in steps:
        p_step = doc.add_paragraph()
        r_st = p_step.add_run(f"• {title}: ")
        r_st.font.bold = True
        r_st.font.color.rgb = RGBColor(43, 108, 176)
        p_step.add_run(desc)

    doc.add_paragraph().paragraph_format.space_after = Pt(8)

    # Section 3: Project 1 Details
    h3 = doc.add_heading(level=1)
    r_h3 = h3.add_run("3. Project 1: Autonomous Drone Edge-AI Pipeline for Crop & Canopy Health")
    r_h3.font.color.rgb = RGBColor(26, 54, 93)

    doc.add_paragraph("Use the following credentials and details to insert Project 1 into the CSE-AI department:")

    p1_table = doc.add_table(rows=1, cols=2)
    p1_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr1 = p1_table.rows[0]
    hdr1.cells[0].paragraphs[0].text = "Form Field"
    hdr1.cells[1].paragraphs[0].text = "Value to Copy & Paste"
    style_table_header(hdr1, hex_color="2C5282")

    p1_fields = [
        ("Department", "Computer Science and Engineering (AI)"),
        ("Theme", "Edge AI & Computer Vision"),
        ("Project Title", "Autonomous Drone Edge-AI Pipeline for Precision Crop & Canopy Health Monitoring"),
        ("Artefact Title", "Edge-Deployed Aerial Multispectral Crop Health Inspector"),
        ("Academic Year", "2026-27"),
        ("Semester", "Sem-5"),
        ("Faculty Mentor", "Dr. Sujata Kotabagi"),
        ("Student 1 (Lead)", "Rohan Deshpande | SRN: 01FE23BCS961 | Div: A | Sem: Sem-5"),
        ("Student 2", "Ananya Kulkarni | SRN: 01FE23BCS962 | Div: A | Sem: Sem-5"),
        ("Student 3", "Varun Hegde | SRN: 01FE23BCS963 | Div: A | Sem: Sem-5"),
        ("Student 4", "Kavya Patil | SRN: 01FE23BCS964 | Div: A | Sem: Sem-5")
    ]

    for idx, (fld, val) in enumerate(p1_fields):
        row = p1_table.add_row()
        row.cells[0].paragraphs[0].text = fld
        row.cells[1].paragraphs[0].text = val
        style_table_row(row, is_alt=(idx % 2 == 1))

    doc.add_paragraph().paragraph_format.space_after = Pt(6)

    # Project 1 Challenges
    p_c1_hdr = doc.add_paragraph()
    r_c1_h = p_c1_hdr.add_run("Project 1 — Challenges to Log in Dashboard (Project Tracking -> Challenges):")
    r_c1_h.font.bold = True
    r_c1_h.font.color.rgb = RGBColor(197, 48, 48)

    p1_challenges = [
        {
            "title": "Drone Edge Compute Thermal Throttling & In-Flight Frame Drop",
            "root_cause": "Unthrottled multispectral image batching causes Jetson Orin compute node to exceed 85°C, reducing core clocks.",
            "impact": "In-flight image processing frame rate drops from 45 FPS to 14 FPS, skipping crop canopy sections.",
            "support": "Lab technician assistance to install lightweight heat pipe enclosure and active micro-fan cooling mount.",
            "status": "IN_PROGRESS",
            "action": "Implement dynamic thermal load management in CUDA kernels and cap batch pipeline frequency at 35 FPS.",
            "owner": "Rohan Deshpande",
            "due": "5 days from today"
        },
        {
            "title": "Multispectral NDVI Calibration Drift Under Dynamic Solar Irradiance",
            "root_cause": "Cloud cover variability alters ambient spectral intensity without dynamic downwelling light sensor compensation.",
            "impact": "Calculated NDVI vegetation index values deviate by up to 22%, triggering false crop water stress alerts.",
            "support": "Faculty review of solar irradiance normalisation equations and sensor calibration coefficient lookup table.",
            "status": "OPEN",
            "action": "Integrate real-time incident sunshine sensor readings to normalize reflectance spectra frame-by-frame.",
            "owner": "Ananya Kulkarni",
            "due": "8 days from today"
        },
        {
            "title": "Telemetry Packet Loss Over 2.4GHz Long-Range Drone-to-Base Radio Link",
            "root_cause": "Dense campus tree canopy causes high multipath fading and Fresnel zone attenuation on 2.4GHz transceiver.",
            "impact": "Ground station loses telemetry heartbeat intermittently during autonomous survey runs at perimeter boundaries.",
            "support": "Procurement of 868MHz high-gain directional patch antenna and diversity receiver module from IoT lab.",
            "status": "OPEN",
            "action": "Switch command/telemetry link to 868MHz telemetry radio with packet retransmission buffers in MAVLink layer.",
            "owner": "Varun Hegde",
            "due": "10 days from today"
        }
    ]

    for ch in p1_challenges:
        tbl = doc.add_table(rows=1, cols=2)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        hdr = tbl.rows[0]
        hdr.cells[0].paragraphs[0].text = "Challenge Field"
        hdr.cells[1].paragraphs[0].text = "Content to Paste"
        style_table_header(hdr, hex_color="742A2A")
        fields = [
            ("Challenge Title", ch["title"]),
            ("Root Cause", ch["root_cause"]),
            ("Academic/System Impact", ch["impact"]),
            ("Support Required", ch["support"]),
            ("Status", ch["status"]),
            ("Corrective Action Plan", ch["action"]),
            ("Action Owner", ch["owner"]),
            ("Target Due Date", ch["due"])
        ]
        for idx, (f, v) in enumerate(fields):
            row = tbl.add_row()
            row.cells[0].paragraphs[0].text = f
            row.cells[1].paragraphs[0].text = v
            style_table_row(row, is_alt=(idx % 2 == 1))
        doc.add_paragraph().paragraph_format.space_after = Pt(4)

    # Project 1 KPIs
    p_k1_hdr = doc.add_paragraph()
    r_k1_h = p_k1_hdr.add_run("Project 1 — Key Performance Indicators (Project Tracking -> KPIs):")
    r_k1_h.font.bold = True
    r_k1_h.font.color.rgb = RGBColor(44, 82, 130)

    p1_kpis = [
        {
            "name": "Canopy Anomaly Detection Inference Latency",
            "target": "35",
            "unit": "ms",
            "desc": "Neural model execution latency per multispectral image frame on edge accelerator.",
            "measured": "31.4",
            "evidence": "TensorRT benchmark output logged across 1,000 flight images captured at 50m survey altitude."
        },
        {
            "name": "NDVI Vegetation Stress Classification Accuracy",
            "target": "93.5",
            "unit": "%",
            "desc": "Accuracy of classifying crop health into healthy, water-stressed, and pathogen-affected categories.",
            "measured": "94.8",
            "evidence": "Confusion matrix analysis validated against ground-truth agronomist ground inspection samples."
        },
        {
            "name": "Aerial Video Ingestion Stream Rate",
            "target": "45",
            "unit": "fps",
            "desc": "Sustained frame processing throughput delivered by hardware-accelerated video decoding pipeline.",
            "measured": "46.2",
            "evidence": "DeepStream pipeline telemetry logs during continuous 20-minute autonomous flight session."
        },
        {
            "name": "Drone Embedded Compute Power Draw",
            "target": "14",
            "unit": "Watts",
            "desc": "Continuous power drawn by flight companion edge computer during simultaneous inference and logging.",
            "measured": "12.6",
            "evidence": "Power rail telemetry readings recorded via Jetson jtop hardware power monitoring service."
        }
    ]

    for k in p1_kpis:
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
            ("Sample Measured Value", k["measured"]),
            ("Verification Evidence", k["evidence"])
        ]
        for idx, (f, v) in enumerate(fields):
            row = tbl.add_row()
            row.cells[0].paragraphs[0].text = f
            row.cells[1].paragraphs[0].text = v
            style_table_row(row, is_alt=(idx % 2 == 1))
        doc.add_paragraph().paragraph_format.space_after = Pt(4)

    doc.add_paragraph().paragraph_format.space_after = Pt(8)

    # Section 4: Project 2 Details
    h4 = doc.add_heading(level=1)
    r_h4 = h4.add_run("4. Project 2: Decentralized Campus Microgrid Energy Distribution Engine")
    r_h4.font.color.rgb = RGBColor(26, 54, 93)

    doc.add_paragraph("Use the following credentials and details to insert Project 2 into the CSE department:")

    p2_table = doc.add_table(rows=1, cols=2)
    p2_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr2 = p2_table.rows[0]
    hdr2.cells[0].paragraphs[0].text = "Form Field"
    hdr2.cells[1].paragraphs[0].text = "Value to Copy & Paste"
    style_table_header(hdr2, hex_color="2C5282")

    p2_fields = [
        ("Department", "Computer Science and Engineering"),
        ("Theme", "Sustainable Campus & Smart Energy"),
        ("Project Title", "Decentralized Campus Microgrid Energy Distribution & Load Forecasting Engine"),
        ("Artefact Title", "Smart Microgrid Energy Balancer & Predictive Dispatcher"),
        ("Academic Year", "2026-27"),
        ("Semester", "Sem-5"),
        ("Faculty Mentor", "Amit Kachavimath"),
        ("Student 1 (Lead)", "Nikhil Rao | SRN: 01FE23BCS971 | Div: B | Sem: Sem-5"),
        ("Student 2", "Deepa Shrestha | SRN: 01FE23BCS972 | Div: B | Sem: Sem-5"),
        ("Student 3", "Karthik Bhat | SRN: 01FE23BCS973 | Div: B | Sem: Sem-5"),
        ("Student 4", "Meera Kulkarni | SRN: 01FE23BCS974 | Div: B | Sem: Sem-5")
    ]

    for idx, (fld, val) in enumerate(p2_fields):
        row = p2_table.add_row()
        row.cells[0].paragraphs[0].text = fld
        row.cells[1].paragraphs[0].text = val
        style_table_row(row, is_alt=(idx % 2 == 1))

    doc.add_paragraph().paragraph_format.space_after = Pt(6)

    # Project 2 Challenges
    p_c2_hdr = doc.add_paragraph()
    r_c2_h = p_c2_hdr.add_run("Project 2 — Challenges to Log in Dashboard (Project Tracking -> Challenges):")
    r_c2_h.font.bold = True
    r_c2_h.font.color.rgb = RGBColor(197, 48, 48)

    p2_challenges = [
        {
            "title": "Solar Inverter Telemetry Desynchronization During Rapid Cloud Transients",
            "root_cause": "Modbus RS485 polling cycle lags during rapid solar insolation dropouts, missing transient voltage spikes.",
            "impact": "Microgrid inverter controller reacts with delay, causing transient campus substation power factor dip.",
            "support": "Access to high-speed digital power meter gateway and Modbus-TCP hardware converter.",
            "status": "IN_PROGRESS",
            "action": "Migrate inverter telemetry polling from 1000ms serial cycle to 50ms event-driven Modbus-TCP broadcast socket.",
            "owner": "Nikhil Rao",
            "due": "6 days from today"
        },
        {
            "title": "Peak-Hour Campus Load Forecasting Error Exceeding 10% on High-Variance Feeder",
            "root_cause": "Standard ARIMA model fails to account for air conditioning chiller compressor start-stop cycles during lunch hours.",
            "impact": "Storage battery bank discharges sub-optimally, incurring higher utility peak demand tariff charges.",
            "support": "Historical 15-minute campus smart meter energy consumption logs for past 12 months from electrical department.",
            "status": "OPEN",
            "action": "Train a hybrid Temporal Fusion Transformer (TFT) incorporating weather forecasts and academic timetable features.",
            "owner": "Deepa Shrestha",
            "due": "9 days from today"
        },
        {
            "title": "MQTT Sensor Telemetry Message Dropping Under Wi-Fi Access Point Congestion",
            "root_cause": "Substation smart meter Wi-Fi modules share 2.4GHz channel with student mobile devices during class break intervals.",
            "impact": "Up to 8% of energy consumption telemetry packets drop between 1:00 PM and 2:00 PM daily.",
            "support": "Campus network team assistance to provision dedicated VLAN and QoS priority bandwidth for smart energy IoT devices.",
            "status": "OPEN",
            "action": "Enable MQTT QoS Level 1 with persistent local SQLite buffer queue on smart meters to retransmit dropped packets.",
            "owner": "Karthik Bhat",
            "due": "7 days from today"
        }
    ]

    for ch in p2_challenges:
        tbl = doc.add_table(rows=1, cols=2)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        hdr = tbl.rows[0]
        hdr.cells[0].paragraphs[0].text = "Challenge Field"
        hdr.cells[1].paragraphs[0].text = "Content to Paste"
        style_table_header(hdr, hex_color="742A2A")
        fields = [
            ("Challenge Title", ch["title"]),
            ("Root Cause", ch["root_cause"]),
            ("Academic/System Impact", ch["impact"]),
            ("Support Required", ch["support"]),
            ("Status", ch["status"]),
            ("Corrective Action Plan", ch["action"]),
            ("Action Owner", ch["owner"]),
            ("Target Due Date", ch["due"])
        ]
        for idx, (f, v) in enumerate(fields):
            row = tbl.add_row()
            row.cells[0].paragraphs[0].text = f
            row.cells[1].paragraphs[0].text = v
            style_table_row(row, is_alt=(idx % 2 == 1))
        doc.add_paragraph().paragraph_format.space_after = Pt(4)

    # Project 2 KPIs
    p_k2_hdr = doc.add_paragraph()
    r_k2_h = p_k2_hdr.add_run("Project 2 — Key Performance Indicators (Project Tracking -> KPIs):")
    r_k2_h.font.bold = True
    r_k2_h.font.color.rgb = RGBColor(44, 82, 130)

    p2_kpis = [
        {
            "name": "Microgrid Short-Term Load Forecast MAPE",
            "target": "4.5",
            "unit": "%",
            "desc": "Mean Absolute Percentage Error for 1-hour-ahead building energy demand prediction.",
            "measured": "3.8",
            "evidence": "Python scikit-learn evaluation report comparing predicted vs actual meter readings across 500 test hours."
        },
        {
            "name": "Automated Phase Balancing Response Time",
            "target": "250",
            "unit": "ms",
            "desc": "Time elapsed from 3-phase current unbalance detection to battery inverter active power dispatch actuation.",
            "measured": "185",
            "evidence": "Oscilloscope and smart inverter timestamped telemetry log recording transient load step responses."
        },
        {
            "name": "Solar Inverter Telemetry Ingestion Reliability",
            "target": "99.8",
            "unit": "%",
            "desc": "Percentage of successful 5-second telemetry data points stored without packet loss or checksum corruption.",
            "measured": "99.92",
            "evidence": "PostgreSQL time-series database continuous ingestion audit query for 7-day operating period."
        },
        {
            "name": "Peak Load Demand Reduction",
            "target": "18.0",
            "unit": "%",
            "desc": "Percentage curtailment in utility grid peak demand achieved through predictive battery discharge shaving.",
            "measured": "19.4",
            "evidence": "Substation energy billing report comparing peak demand charges before and after automated shaving dispatch."
        }
    ]

    for k in p2_kpis:
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
            ("Sample Measured Value", k["measured"]),
            ("Verification Evidence", k["evidence"])
        ]
        for idx, (f, v) in enumerate(fields):
            row = tbl.add_row()
            row.cells[0].paragraphs[0].text = f
            row.cells[1].paragraphs[0].text = v
            style_table_row(row, is_alt=(idx % 2 == 1))
        doc.add_paragraph().paragraph_format.space_after = Pt(4)

    doc.add_paragraph().paragraph_format.space_after = Pt(8)

    # Section 5: Verification Checklist
    h5 = doc.add_heading(level=1)
    r_h5 = h5.add_run("5. Post-Creation Verification Checklist")
    r_h5.font.color.rgb = RGBColor(26, 54, 93)

    checklist_items = [
        "Jira Cloud Board Provisioning: Look for '[🔷 Jira Board (KEY) ↗]' in the top-right header and click to verify the Jira software board opened.",
        "Kanban Board Tasks: Open Project Workspace to verify that 3 starter tasks are present, interactive move buttons (← To Do, In Progress →, Completed ✓) are visible, and each task displays its '🔷 KEY-N ↗' Jira badge.",
        "KPI Jira Integration: Open the KPIs tab to verify that starter and newly added KPIs display live '🔷 KEY-N ↗' badges linking directly to Jira tickets.",
        "Challenge Jira Integration: Log any of the challenges above and confirm that an associated Jira ticket is generated with root cause and impact details.",
        "Role Permissions: Test logging in as HOD, Dean, Faculty Mentor, and Student to verify correct role-based editing boundaries."
    ]

    for item in checklist_items:
        p_chk = doc.add_paragraph()
        r_c_box = p_chk.add_run("☑  ")
        r_c_box.font.bold = True
        r_c_box.font.color.rgb = RGBColor(40, 167, 69)
        p_chk.add_run(item)

    # Save DOCX
    doc.save(DOCX_PATH)
    print(f"Successfully generated Word document: {DOCX_PATH}")
    try:
        doc.save(OLD_DOCX_PATH)
        print(f"Also updated: {OLD_DOCX_PATH}")
    except Exception as e:
        print(f"Notice: Could not overwrite {OLD_DOCX_PATH} (may be open in Word): {e}")

def generate_pdf():
    doc = SimpleDocTemplate(
        PDF_PATH,
        pagesize=letter,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontSize=20,
        leading=24,
        textColor=colors.HexColor('#1A365D'),
        fontName='Helvetica-Bold',
        spaceAfter=4
    )

    subtitle_style = ParagraphStyle(
        'DocSub',
        parent=styles['Normal'],
        fontSize=11,
        leading=14,
        textColor=colors.HexColor('#3182CE'),
        fontName='Helvetica-Bold',
        spaceAfter=3
    )

    meta_style = ParagraphStyle(
        'DocMeta',
        parent=styles['Normal'],
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor('#718096'),
        fontName='Helvetica-Oblique',
        spaceAfter=8
    )

    h1_style = ParagraphStyle(
        'H1',
        parent=styles['Heading2'],
        fontSize=12,
        leading=16,
        textColor=colors.HexColor('#1A365D'),
        fontName='Helvetica-Bold',
        spaceBefore=8,
        spaceAfter=4
    )

    h2_style = ParagraphStyle(
        'H2',
        parent=styles['Heading3'],
        fontSize=10,
        leading=13,
        textColor=colors.HexColor('#2C5282'),
        fontName='Helvetica-Bold',
        spaceBefore=6,
        spaceAfter=3
    )

    body_style = ParagraphStyle(
        'Body',
        parent=styles['Normal'],
        fontSize=8,
        leading=11,
        textColor=colors.HexColor('#2D3748'),
        fontName='Helvetica'
    )

    th_style = ParagraphStyle(
        'TH',
        parent=styles['Normal'],
        fontSize=8,
        leading=10,
        textColor=colors.white,
        fontName='Helvetica-Bold'
    )

    story = []

    # Title & Subtitle
    story.append(Paragraph("ApniLeap Mini-Project Portfolio Portal", title_style))
    story.append(Paragraph("Demo Credentials, Project Creation & Dashboard Input Guide for Two New Projects", subtitle_style))
    story.append(Paragraph("Portal URL: http://localhost:4000  |  Jira Cloud: https://apnileap-portfolio.atlassian.net  |  Default Password: Demo@12345", meta_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor('#1A365D'), spaceAfter=8))

    # Section 1: User Accounts & Credentials
    story.append(Paragraph("1. Institutional User Accounts & Demo Credentials", h1_style))
    story.append(Paragraph("All pre-configured user accounts are initialized with standard password: <b><font color='#C53030'>Demo@12345</font></b>", body_style))
    story.append(Spacer(1, 4))

    cred_data = [
        [Paragraph("Role", th_style), Paragraph("Login Email", th_style), Paragraph("Password", th_style), Paragraph("Key Permissions & Access Scope", th_style)],
        [Paragraph("Platform Admin", body_style), Paragraph("admin@apnileap.org", body_style), Paragraph("Demo@12345", body_style), Paragraph("Global governance, unrestricted project creation.", body_style)],
        [Paragraph("Dean / Principal (KLE)", body_style), Paragraph("kle.dean@apnileap.org", body_style), Paragraph("Demo@12345", body_style), Paragraph("Institute governance, project creation across all departments.", body_style)],
        [Paragraph("HOD - CSE (AI)", body_style), Paragraph("kle.hod.cseai@apnileap.org", body_style), Paragraph("Demo@12345", body_style), Paragraph("CSE-AI project creation, mentor allocation, review approvals.", body_style)],
        [Paragraph("HOD - CSE", body_style), Paragraph("kle.hod.cse@apnileap.org", body_style), Paragraph("Demo@12345", body_style), Paragraph("CSE department project creation, mentor reviews, portfolio governance.", body_style)],
        [Paragraph("Faculty Mentor (CSE-AI)", body_style), Paragraph("sujata.kotabagi@kletech.ac.in", body_style), Paragraph("Demo@12345", body_style), Paragraph("Assigned CSE-AI projects, milestone & KPI updates, challenge logging.", body_style)],
        [Paragraph("Faculty Mentor (CSE)", body_style), Paragraph("amit.kachavimath@kletech.ac.in", body_style), Paragraph("Demo@12345", body_style), Paragraph("Assigned CSE projects, milestone & KPI updates, challenge resolution.", body_style)],
        [Paragraph("Student Account (Demo)", body_style), Paragraph("01fe23bcs001@kletech.ac.in", body_style), Paragraph("Demo@12345", body_style), Paragraph("Project workspace view, task movement, evidence submission.", body_style)]
    ]

    t_cred = Table(cred_data, colWidths=[105, 125, 65, 245])
    t_cred.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1A365D')),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E0')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#F7FAFC')])
    ]))
    story.append(t_cred)
    story.append(Spacer(1, 8))

    # Section 2: Instructions to Insert New Project
    story.append(Paragraph("2. Step-by-Step Instructions to Insert a New Project", h1_style))
    steps_pdf = [
        "<b>Step 1: Sign in with a Governance Account:</b> Log in at http://localhost:4000 with kle.hod.cseai@apnileap.org or kle.dean@apnileap.org (Password: Demo@12345).",
        "<b>Step 2: Navigate to Target Department:</b> Click on the Department, select the Theme, then click '+ Add Project'.",
        "<b>Step 3: Enter Project & Team Details:</b> Copy and paste Title, Artefact, Mentor Name, Academic Year (2026-27), Semester (Sem-5), and 4 student SRNs from below.",
        "<b>Step 4: Save & Automated Jira Provisioning:</b> Click 'Save Project'. ApniLeap provisions the Jira Cloud board, seeds tasks, and creates Jira-linked KPIs.",
        "<b>Step 5: Verify on Dashboard & Workspace:</b> Click the '[🔷 Jira Board ↗]' button to open the live board, or open the workspace to interact with tasks."
    ]
    for st in steps_pdf:
        story.append(Paragraph(f"• {st}", body_style))
        story.append(Spacer(1, 2))
    story.append(Spacer(1, 6))

    # Section 3: Project 1 Details
    story.append(Paragraph("3. Project 1: Autonomous Drone Edge-AI Pipeline for Crop & Canopy Health", h1_style))
    p1_meta_data = [
        [Paragraph("Form Field", th_style), Paragraph("Value to Copy & Paste", th_style)],
        [Paragraph("Department", body_style), Paragraph("Computer Science and Engineering (AI)", body_style)],
        [Paragraph("Theme", body_style), Paragraph("Edge AI & Computer Vision", body_style)],
        [Paragraph("Project Title", body_style), Paragraph("Autonomous Drone Edge-AI Pipeline for Precision Crop & Canopy Health Monitoring", body_style)],
        [Paragraph("Artefact Title", body_style), Paragraph("Edge-Deployed Aerial Multispectral Crop Health Inspector", body_style)],
        [Paragraph("Academic Year / Sem", body_style), Paragraph("2026-27 / Sem-5", body_style)],
        [Paragraph("Faculty Mentor", body_style), Paragraph("Dr. Sujata Kotabagi", body_style)],
        [Paragraph("Student 1 (Lead)", body_style), Paragraph("Rohan Deshpande | SRN: 01FE23BCS961 | Div: A | Sem: Sem-5", body_style)],
        [Paragraph("Student 2", body_style), Paragraph("Ananya Kulkarni | SRN: 01FE23BCS962 | Div: A | Sem: Sem-5", body_style)],
        [Paragraph("Student 3", body_style), Paragraph("Varun Hegde | SRN: 01FE23BCS963 | Div: A | Sem: Sem-5", body_style)],
        [Paragraph("Student 4", body_style), Paragraph("Kavya Patil | SRN: 01FE23BCS964 | Div: A | Sem: Sem-5", body_style)]
    ]
    t_p1 = Table(p1_meta_data, colWidths=[130, 410])
    t_p1.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#2C5282')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 2.5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 2.5),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E0')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#F7FAFC')])
    ]))
    story.append(t_p1)
    story.append(Spacer(1, 6))

    # Project 1 Challenges Table
    story.append(Paragraph("<b>Project 1 Challenges to Log:</b>", h2_style))
    p1_ch_data = [
        [Paragraph("Challenge Title", th_style), Paragraph("Root Cause & Impact", th_style), Paragraph("Action Plan & Owner", th_style)],
        [Paragraph("Drone Edge Compute Thermal Throttling", body_style), Paragraph("Kernel load causes Jetson Orin to hit 85°C. Video drops to 14 FPS, skipping canopy sections.", body_style), Paragraph("Cap batch frequency at 35 FPS, apply heat-pipe cooling.<br/><b>Owner:</b> Rohan Deshpande", body_style)],
        [Paragraph("NDVI Calibration Drift Under Variable Sun", body_style), Paragraph("Cloud variability changes spectral intensity. NDVI deviates by 22% triggering false alerts.", body_style), Paragraph("Normalize reflectance spectra frame-by-frame using downwelling sensor.<br/><b>Owner:</b> Ananya Kulkarni", body_style)],
        [Paragraph("Telemetry Packet Loss Over 2.4GHz Link", body_style), Paragraph("Dense tree canopy attenuates 2.4GHz signal, losing telemetry heartbeat at boundaries.", body_style), Paragraph("Switch link to 868MHz high-gain antenna with packet retransmission.<br/><b>Owner:</b> Varun Hegde", body_style)]
    ]
    t_p1_ch = Table(p1_ch_data, colWidths=[140, 210, 190])
    t_p1_ch.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#742A2A')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E0')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#F7FAFC')])
    ]))
    story.append(t_p1_ch)
    story.append(Spacer(1, 6))

    # Project 1 KPIs Table
    story.append(Paragraph("<b>Project 1 KPIs to Enter:</b>", h2_style))
    p1_kpi_data = [
        [Paragraph("KPI Name", th_style), Paragraph("Target", th_style), Paragraph("Measured", th_style), Paragraph("Evidence Note", th_style)],
        [Paragraph("Canopy Anomaly Detection Latency", body_style), Paragraph("35 ms", body_style), Paragraph("31.4 ms", body_style), Paragraph("TensorRT benchmark output logged across 1,000 flight images.", body_style)],
        [Paragraph("NDVI Vegetation Classification Accuracy", body_style), Paragraph("93.5 %", body_style), Paragraph("94.8 %", body_style), Paragraph("Validated against ground-truth agronomist inspection samples.", body_style)],
        [Paragraph("Aerial Video Ingestion Stream Rate", body_style), Paragraph("45 fps", body_style), Paragraph("46.2 fps", body_style), Paragraph("DeepStream pipeline telemetry logs during 20-minute flight.", body_style)],
        [Paragraph("Drone Embedded Compute Power Draw", body_style), Paragraph("14 Watts", body_style), Paragraph("12.6 Watts", body_style), Paragraph("Power rail telemetry recorded via Jetson jtop utility.", body_style)]
    ]
    t_p1_kp = Table(p1_kpi_data, colWidths=[170, 55, 65, 250])
    t_p1_kp.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#2B6CB0')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E0')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#F7FAFC')])
    ]))
    story.append(t_p1_kp)
    story.append(Spacer(1, 10))

    # Section 4: Project 2 Details
    story.append(Paragraph("4. Project 2: Decentralized Campus Microgrid Energy Distribution Engine", h1_style))
    p2_meta_data = [
        [Paragraph("Form Field", th_style), Paragraph("Value to Copy & Paste", th_style)],
        [Paragraph("Department", body_style), Paragraph("Computer Science and Engineering", body_style)],
        [Paragraph("Theme", body_style), Paragraph("Sustainable Campus & Smart Energy", body_style)],
        [Paragraph("Project Title", body_style), Paragraph("Decentralized Campus Microgrid Energy Distribution & Load Forecasting Engine", body_style)],
        [Paragraph("Artefact Title", body_style), Paragraph("Smart Microgrid Energy Balancer & Predictive Dispatcher", body_style)],
        [Paragraph("Academic Year / Sem", body_style), Paragraph("2026-27 / Sem-5", body_style)],
        [Paragraph("Faculty Mentor", body_style), Paragraph("Amit Kachavimath", body_style)],
        [Paragraph("Student 1 (Lead)", body_style), Paragraph("Nikhil Rao | SRN: 01FE23BCS971 | Div: B | Sem: Sem-5", body_style)],
        [Paragraph("Student 2", body_style), Paragraph("Deepa Shrestha | SRN: 01FE23BCS972 | Div: B | Sem: Sem-5", body_style)],
        [Paragraph("Student 3", body_style), Paragraph("Karthik Bhat | SRN: 01FE23BCS973 | Div: B | Sem: Sem-5", body_style)],
        [Paragraph("Student 4", body_style), Paragraph("Meera Kulkarni | SRN: 01FE23BCS974 | Div: B | Sem: Sem-5", body_style)]
    ]
    t_p2 = Table(p2_meta_data, colWidths=[130, 410])
    t_p2.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#2C5282')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 2.5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 2.5),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E0')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#F7FAFC')])
    ]))
    story.append(t_p2)
    story.append(Spacer(1, 6))

    # Project 2 Challenges Table
    story.append(Paragraph("<b>Project 2 Challenges to Log:</b>", h2_style))
    p2_ch_data = [
        [Paragraph("Challenge Title", th_style), Paragraph("Root Cause & Impact", th_style), Paragraph("Action Plan & Owner", th_style)],
        [Paragraph("Solar Inverter Telemetry Desynchronization", body_style), Paragraph("RS485 polling cycle lags during rapid solar insolation drops, causing substation power factor dips.", body_style), Paragraph("Migrate from 1000ms serial to 50ms event-driven Modbus-TCP socket.<br/><b>Owner:</b> Nikhil Rao", body_style)],
        [Paragraph("Peak-Hour Load Forecasting Error > 10%", body_style), Paragraph("ARIMA model fails to capture chiller compressor start-stop cycles, discharging batteries sub-optimally.", body_style), Paragraph("Train Temporal Fusion Transformer model incorporating timetable features.<br/><b>Owner:</b> Deepa Shrestha", body_style)],
        [Paragraph("MQTT Telemetry Dropping Under Wi-Fi Traffic", body_style), Paragraph("Substation smart meters share 2.4GHz Wi-Fi with campus mobile traffic during peak lunch breaks.", body_style), Paragraph("Enable MQTT QoS Level 1 with persistent local buffer queue.<br/><b>Owner:</b> Karthik Bhat", body_style)]
    ]
    t_p2_ch = Table(p2_ch_data, colWidths=[140, 210, 190])
    t_p2_ch.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#742A2A')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E0')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#F7FAFC')])
    ]))
    story.append(t_p2_ch)
    story.append(Spacer(1, 6))

    # Project 2 KPIs Table
    story.append(Paragraph("<b>Project 2 KPIs to Enter:</b>", h2_style))
    p2_kpi_data = [
        [Paragraph("KPI Name", th_style), Paragraph("Target", th_style), Paragraph("Measured", th_style), Paragraph("Evidence Note", th_style)],
        [Paragraph("Microgrid Short-Term Load Forecast MAPE", body_style), Paragraph("4.5 %", body_style), Paragraph("3.8 %", body_style), Paragraph("Scikit-learn evaluation report comparing predicted vs actual readings.", body_style)],
        [Paragraph("Automated Phase Balancing Response Time", body_style), Paragraph("250 ms", body_style), Paragraph("185 ms", body_style), Paragraph("Inverter timestamped telemetry log recording transient load step responses.", body_style)],
        [Paragraph("Solar Inverter Ingestion Reliability", body_style), Paragraph("99.8 %", body_style), Paragraph("99.92 %", body_style), Paragraph("PostgreSQL time-series database continuous ingestion audit query for 7 days.", body_style)],
        [Paragraph("Peak Load Demand Reduction", body_style), Paragraph("18.0 %", body_style), Paragraph("19.4 %", body_style), Paragraph("Substation billing report comparing peak demand charges before/after dispatch.", body_style)]
    ]
    t_p2_kp = Table(p2_kpi_data, colWidths=[170, 55, 65, 250])
    t_p2_kp.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#2B6CB0')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E0')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#F7FAFC')])
    ]))
    story.append(t_p2_kp)
    story.append(Spacer(1, 8))

    # Section 5: Verification Checklist
    story.append(Paragraph("5. Post-Creation Verification Checklist", h1_style))
    chk_pdf = [
        "<b>Jira Cloud Board:</b> Click [🔷 Jira Board ↗] in the project header to confirm the dedicated software board opens.",
        "<b>Workspace Kanban Tasks:</b> Verify 3 tasks appear with active transition buttons (← To Do, In Progress →, Completed ✓) and Jira issue links.",
        "<b>KPI Hyperlinks:</b> Open the KPIs tab to verify that starter and newly added KPIs display clickable 🔷 KEY-N ↗ badges.",
        "<b>Challenge Hyperlinks:</b> Log any sample challenge and confirm an associated Jira issue is created with a live link."
    ]
    for ck in chk_pdf:
        story.append(Paragraph(f"[✓] {ck}", body_style))
        story.append(Spacer(1, 2))

    doc.build(story)
    print(f"Successfully generated PDF document: {PDF_PATH}")
    try:
        import shutil
        shutil.copyfile(PDF_PATH, OLD_PDF_PATH)
        print(f"Also updated: {OLD_PDF_PATH}")
    except Exception as e:
        print(f"Notice: Could not overwrite {OLD_PDF_PATH}: {e}")

if __name__ == '__main__':
    generate_docx()
    generate_pdf()
