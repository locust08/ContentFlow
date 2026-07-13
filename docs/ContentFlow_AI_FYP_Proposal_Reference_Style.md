# FACULTY OF INFORMATION SCIENCE

# CAMPUS OF PUNCAK PERDANA

# BACHELOR OF INFORMATION SCIENCE (HONS.)
# INFORMATION CONTENT MANAGEMENT (CDIM263)

# ICM658 - DIGITAL INFORMATION CONTENT MANAGEMENT PROJECT

## PROPOSAL TITLE:
# CONTENTFLOW AI: AI-ASSISTED CONTENT OPERATIONS MANAGEMENT SYSTEM FOR A SMALL SOCIAL MEDIA AGENCY

## PREPARED FOR:
[Supervisor / Lecturer Name]

## PREPARED BY
[Student Name] ([Student ID])

## GROUP:
[Group]

## SUBMISSION DATE:
[Submission Date]

\pagebreak

# ACKNOWLEDGEMENT

Alhamdulillah, first and foremost, I am grateful to Allah S.W.T. for granting me the strength, time, and opportunity to prepare this proposal for ICM658 - Digital Information Content Management Project. This proposal is prepared as part of the final year project requirement for the Bachelor of Information Science (Hons.) Information Content Management programme.

I would like to express my appreciation to my lecturer and supervisor for the guidance provided throughout the proposal preparation process. The explanation of the capstone requirements helped me understand that the project must not only present an idea, but must also design a practical information system prototype that includes web programming, mobile application development, database design, and data analysis for digital content management (Universiti Teknologi MARA, 2023).

I would also like to thank my family, classmates, and friends for their continuous support. Their encouragement helped me refine this project idea into a more structured academic proposal. Finally, appreciation is extended to all researchers, institutions, and technical documentation sources cited in this proposal, as their findings and explanations provide the evidence used to justify the proposed solution.

\pagebreak

# TABLE OF CONTENTS

[AUTO_TOC]

\pagebreak

# TABLE OF FIGURES

Figure 1: ContentFlow AI System Architecture

Figure 2: ContentFlow AI System Flow

Figure 3: ContentFlow AI Entity Relationship Diagram (ERD)

# TABLE OF TABLES

Table 1: ERD Relationship Summary

Table 2: Gantt Chart of Project Timeline

\pagebreak

# 1. PROBLEM STATEMENT

## 1.1. BACKGROUND OF THE PROBLEM

Social media content has become an important part of digital marketing for small businesses because it helps businesses communicate with customers through visual and interactive channels. Oklahoma State University Extension explains that social media gives small businesses an opportunity to connect with customers, create engaging content, build a strong presence, and measure performance using platform analytics (Siems et al., 2025). Because of this, small social media agencies play an important role in helping SME clients plan, produce, review, and deliver content consistently.

The type of digital content managed by a small agency is no longer limited to simple images or captions. A typical short-form video project may involve product photos, reference videos, raw footage, scripts, transcripts, generated captions, subtitles, highlight clips, approval comments, and final rendered MP4 files. Research on short-form video content explains that this format is important because it fits current digital consumption habits and allows brands to attract attention through short and shareable content (Manic, 2024). Therefore, agencies that produce TikTok, Reels, and Shorts content need a structured way to manage many media assets and production tasks.

However, many small agencies still manage these digital assets using separate tools such as WhatsApp, Telegram, Google Drive, local folders, spreadsheets, and editing software. Digital Asset Management (DAM) literature explains that organizing, storing, retrieving, and sharing digital assets is essential for media-producing organizations because lost assets, unclear versions, and weak metadata can delay production and reduce efficiency (Crozier, 2024). This shows that the problem is not only about creating videos. It is also about managing the full digital content process from client brief to final output.

Based on the ICM658 course information, students are expected to design and build a prototype of an information system for managing digital content in an organization, including web programming, mobile app development, database design, and data analysis from the completed prototype (Universiti Teknologi MARA, 2023). Therefore, ContentFlow AI is proposed as an AI-assisted content operations management system for a small social media agency. The system is designed to centralize content projects, organize digital media assets, assist video generation and clipping workflows, track approvals, and provide production analytics through a database-backed prototype.

## 1.2. PROBLEM IDENTIFICATION

The main problem is that small social media agencies often handle digital content production through scattered and manual workflows. For example, a client brief may be discussed in WhatsApp, product assets may be stored in Google Drive, reference videos may be saved as links in chat, and the final rendered file may be stored in a local project folder. As a result, the agency may spend extra time searching for files, confirming the latest version, checking whether a clip has been approved, and reporting how many outputs have been produced for a campaign.

From a digital asset management perspective, this situation is problematic because DAM is meant to centralize media files, support asset sharing, improve searchability, and reduce the risk of version confusion (Crozier, 2024; Adobe, 2025). When a small agency does not have a structured system, content assets are not connected to client, campaign, staff assignment, approval status, or production analytics. This weakens the agency's ability to treat digital content as managed information assets.

Another problem is that editors need to do many repeated tasks when producing short-form videos. Reference videos must be reviewed, hooks must be identified, transcripts must be checked, subtitles must be prepared, and final clips must be rendered. AI-assisted content creation can help with ideas, automation, personalization, and data-based improvement, but it still needs human review because there may be issues with quality, privacy, and bias (Coursera, 2026). Therefore, a suitable system should not fully replace editors. It should assist them and make the content workflow easier to manage.

The agency also needs better production monitoring. Without a database backend, managers cannot easily query how many projects are active, which staff member uploaded assets, how many clip candidates were generated, how many videos were rendered, or which campaign is waiting for approval. This does not meet the capstone expectation for database design and data analysis. The briefing for ICM658 also states that the project must include a web-based application, mobile app, database, and workable prototype, and warns students not to use unsuitable tools such as spreadsheets or Google Forms as the database (Amzari Abu Bakar, 2026).

## 1.3. IMPORTANCE OF THE PROBLEM

This problem is important because digital content production is time-sensitive. Short-form social media content depends on speed, consistency, and the ability to respond quickly to campaign needs. If the agency's assets and production status are scattered, the team may lose time searching for reference materials, repeating edits, or checking approval status manually. In video production environments, lost assets and unclear versions can delay work and create extra pressure for the team (Crozier, 2024).

The problem is also important because small businesses increasingly depend on social media to build customer relationships, publish engaging content, and measure campaign performance (Siems et al., 2025). A small agency that serves these businesses must be able to manage content professionally even if it operates with limited staff. A structured content operations system can help the agency organize its work, support staff collaboration, and maintain a clearer record of each campaign's digital content lifecycle.

ContentFlow AI is proposed to solve this problem by combining content management, AI-assisted media processing, approval workflow, and analytics. This aligns with CLO1 because the project focuses on designing a solution to a problem in managing digital content. Therefore, this proposal does not present the system as only an AI video generator. It presents the system as an information system prototype that manages digital media assets, content production processes, and database-backed reporting for an organization.

# 2. OBJECTIVES

## 2.1. GENERAL OBJECTIVE

To design and develop ContentFlow AI, an AI-assisted content operations management system that helps a small social media agency manage client content projects, digital media assets, AI-supported video generation, automatic clipping workflows, approval status, and production analytics through a web dashboard, mobile staff module, and Supabase PostgreSQL database backend.

## 2.2. SPECIFIC OBJECTIVES (SMART)

The specific objectives are developed using the SMART approach so that each objective is clear, measurable, achievable, relevant, and time-bound.

1. To design and develop a web-based admin dashboard that allows agency managers to create clients, campaigns, projects, folders, staff assignments, approval statuses, rendered content records, and analytics views by the end of the prototype development phase.
2. To design and develop a mobile application module using a responsive and installable PWA approach that allows staff to upload product images, reference videos, reaction character assets, and review generated content outputs using mobile devices.
3. To implement a Supabase PostgreSQL database backend that stores users, organizations, clients, campaigns, projects, assets, clip candidates, render jobs, approval records, and analytics events in a structured DBMS.
4. To integrate AI-assisted content production features that support reference video analysis, content idea generation, script planning, highlight candidate generation, subtitle planning, and final MP4 rendering.
5. To develop an analytics dashboard or reporting view that displays production data such as total projects, videos rendered, clip candidates generated, project status, staff upload activity, approval status, and monthly production trends.
6. To evaluate the prototype through functional testing, database testing, mobile workflow testing, and usability testing with at least 10 relevant users such as agency staff, editors, content managers, content creators, or student testers.

# 3. TARGET USERS AND USE CASES

## 3.1. TARGET USERS

### 3.1.1. Agency Administrator / Manager

The administrator or manager is the main decision-maker in the agency workflow. This user creates client records, campaign records, project folders, staff assignments, approval statuses, and analytics reports. The manager needs a system view that shows the overall production pipeline, because social media management requires consistent planning, content creation, and measurement of performance (Siems et al., 2025).

### 3.1.2. Content Editor

The content editor manages reference videos, product materials, generated scripts, highlight candidates, subtitles, and rendered MP4 files. The editor uses the AI Generator and Auto Clipper modules to reduce repetitive production tasks while still applying human judgement to clip selection, script suitability, subtitle quality, and final output readiness.

### 3.1.3. Mobile Staff / Content Assistant

The mobile staff member supports field-level content operations. This user may upload product photos, reference links, short videos, reaction character files, and supporting materials using a mobile device. The mobile module is important because PWA-style applications can provide app-like access and installation on supported devices while using web technologies (web.dev, n.d.; MDN Web Docs, 2025).

### 3.1.4. Client Reviewer / Internal Reviewer

The reviewer checks whether generated videos, subtitles, and clip choices match the campaign objective and client expectation. This user updates approval status and provides feedback, ensuring that AI-assisted outputs still go through human review before delivery.

## 3.2. USE CASE SCENARIOS

### 3.2.1. Use Case 1: Manager Creates a Client Campaign

The manager logs in to the web dashboard, creates a client profile, adds a campaign, defines the campaign objective, and creates a new content project. The system stores the records in the database so that every project is connected to the correct client and campaign.

### 3.2.2. Use Case 2: Staff Uploads Product and Reference Assets

The staff member opens the mobile module, selects the assigned project, and uploads product images, reference videos, source links, or reaction character assets. The uploaded files are linked to the project and can later be used by the editor during AI generation or clipping.

### 3.2.3. Use Case 3: Editor Uses AI Generator Workflow

The editor uploads or selects a reference video and supporting assets. The system analyses the reference, generates a style blueprint, suggests content ideas, prepares script plans, creates prompts, and supports final short-form video rendering.

### 3.2.4. Use Case 4: Editor Uses Auto Clipper Workflow

The editor submits a long-form video or source link. The system extracts audio, transcribes the content, identifies highlight candidates, creates subtitle plans, and allows the editor to select suitable segments for rendering into short-form MP4 clips.

### 3.2.5. Use Case 5: Reviewer Approves or Requests Changes

The reviewer opens the rendered output, checks the clip, subtitle, and campaign suitability, then updates the approval status. If revision is needed, feedback is stored in the system and can be tracked by the manager and editor.

### 3.2.6. Use Case 6: Manager Views Analytics

The manager opens the analytics dashboard to view total projects, project types, rendered videos, approval breakdown, staff upload activity, and monthly production trends. This supports the ICM658 data analysis requirement because production data can be queried and reported from the prototype database.

# 4. SCOPE OF THE PROTOTYPE

## 4.1. IN SCOPE

### 4.1.1. Web Admin Dashboard

The prototype will include a web-based admin dashboard for managing clients, campaigns, folders, projects, staff assignments, approval status, AI Generator projects, Auto Clipper projects, rendered videos, and production analytics.

### 4.1.2. Mobile Application Module

The prototype will include a mobile application module using a responsive installable PWA approach. The module will focus on asset upload, assigned project viewing, clip preview, and approval feedback. This approach is suitable because PWAs can provide an app-like user experience on supported devices while using web technologies (web.dev, n.d.; MDN Web Docs, 2025).

### 4.1.3. Supabase PostgreSQL Database

The prototype will use Supabase PostgreSQL as the DBMS backend. Supabase is suitable because every Supabase project includes a full PostgreSQL database and supports related services such as authentication, storage, APIs, and row-level security (Supabase, 2026).

### 4.1.4. AI Generator Module

The AI Generator module will support reference video analysis, metadata extraction, transcript generation, style analysis, content idea generation, script planning, image prompt generation, video prompt generation, and final edit plan preparation.

### 4.1.5. Auto Clipper Module

The Auto Clipper module will support source video input, audio extraction, transcription, highlight candidate generation, clip selection, subtitle planning, and final clip rendering.

### 4.1.6. Rendering and Subtitle Output

The system will support MP4 rendering using Remotion and FFmpeg-based media processing. FFmpeg is suitable because it can read, filter, and transcode many media formats (FFmpeg, n.d.), while Remotion supports programmatic video creation and MP4 rendering using React-based compositions (Remotion, n.d.).

### 4.1.7. Analytics Dashboard

The prototype will include analytics views that query production data from Supabase. Metrics may include project totals, project types, render counts, approval status, staff upload activity, clip candidate counts, and monthly production trends.

### 4.1.8. User Evaluation

The prototype will be tested with at least 10 relevant users to evaluate usability and workflow clarity. Nielsen (2000) explains that small usability tests can reveal many usability problems, while this project chooses at least 10 users to provide broader student-project feedback.

## 4.2. OUT OF SCOPE

### 4.2.1. Full Social Media Scheduling

The prototype will not include full social media scheduling or direct posting to TikTok, Instagram, Facebook, or YouTube.

### 4.2.2. Advanced Client Billing

The prototype will not include payment processing, invoicing, subscription billing, or advanced client account billing.

### 4.2.3. Full Cloud Rendering Infrastructure

The prototype will not implement a large-scale cloud rendering queue. Local or limited server-side rendering is sufficient for the academic prototype.

### 4.2.4. Advanced AI Model Training

The project will not train a custom AI model. It will use existing AI APIs or fallback logic for analysis, generation, transcription, and highlight selection.

### 4.2.5. Public Marketplace Platform

The prototype will not function as a public marketplace for creators or agencies. It is designed for one small agency's internal content operations.

### 4.2.6. Complex Enterprise Role Management

The prototype will include basic roles such as admin, editor, staff, and reviewer. Advanced enterprise permissions and audit governance are outside the prototype scope.

# 5. SYSTEM OVERVIEW / ARCHITECTURE

## 5.1. SYSTEM OVERVIEW

ContentFlow AI is a web and mobile-based information system prototype for managing digital content production in a small social media agency. The system helps the agency organize clients, campaigns, content projects, uploaded assets, AI-assisted generation workflows, auto-clipping workflows, rendered videos, approval status, and production analytics. The proposed system is designed around the principle that digital assets should be stored, retrieved, shared, and tracked in a structured manner rather than being scattered across separate communication and storage tools (Crozier, 2024; Adobe, 2025).

The existing prototype foundation already includes a local Node.js dashboard, project folder structure, AI Generator workflow, Auto Clipper workflow, FFmpeg media processing, Remotion rendering, and sample rendered MP4 outputs. For the final year project, these functions will be reframed and extended into a full content operations management system with Supabase PostgreSQL database storage and a mobile staff module. This ensures that the project follows the ICM658 requirement for a web-based application, mobile application, database backend, workable prototype, and data analysis component (Amzari Abu Bakar, 2026).

## 5.2. SYSTEM ARCHITECTURE

### 5.2.1. Frontend

The frontend web dashboard will be used by administrators, managers, and editors. It will include project management, client management, campaign management, asset management, AI Generator controls, Auto Clipper controls, render preview, approval status, and analytics views.

### 5.2.2. Mobile Application Module

The mobile module will be designed as a responsive installable PWA-style mobile app. It will allow staff to access assigned projects, upload assets from mobile devices, preview generated clips, and submit review feedback. This provides the required mobile component while keeping the implementation manageable within the final year project scope.

### 5.2.3. Backend

The backend will manage API requests for project creation, asset upload, AI workflow execution, clipping, rendering, approval updates, and analytics queries. The existing Node.js backend will be adapted to communicate with Supabase and the media processing services.

### 5.2.4. Database

Supabase PostgreSQL will store the structured operational records for the system. The database will include tables for users, organizations, clients, campaigns, projects, assets, clip candidates, render jobs, approval feedback, and analytics events. This database design supports both operational workflow and later data analysis.

### 5.2.5. Media Processing and Rendering

The media processing layer will handle video metadata extraction, audio extraction, transcription, reference analysis, content generation, highlight selection, subtitle planning, and MP4 rendering. FFmpeg will support media conversion and processing (FFmpeg, n.d.), while Remotion will support code-based rendering of vertical videos (Remotion, n.d.).

### 5.2.6. External Tools and APIs

External AI APIs may be used for transcription, reference analysis, content ideas, script planning, highlight detection, and prompt generation. These APIs will be used as assistant tools, while final selection and approval remain under human review because AI content creation has benefits but also limitations and ethical considerations (Coursera, 2026).

[FIGURE:architecture]

Figure 1: ContentFlow AI System Architecture

## 5.3. SYSTEM FLOW

The system flow begins when the agency manager creates a client and campaign record. The manager then creates a project, assigns staff, and chooses whether the project will use the AI Generator or Auto Clipper workflow. Staff members upload assets through the mobile module, while editors process the content using AI-assisted workflows. After rendering, reviewers provide approval feedback and managers monitor analytics from the dashboard.

[FIGURE:system_flow]

Figure 2: ContentFlow AI System Flow

## 5.4. DATABASE DESIGN / ERD

The proposed ERD is designed to show how the main operational records are connected. Users belong to an organization and may be assigned to projects or approvals. Clients have campaigns, campaigns have projects, and projects have digital assets, clip candidates, render jobs, approvals, and analytics events. This structure supports relational database design and allows the prototype to query production data for reporting.

[FIGURE:erd]

Figure 3: ContentFlow AI Entity Relationship Diagram (ERD)

Table 1: ERD Relationship Summary

[ERD_RELATIONSHIP_TABLE]

The proposed database design mainly uses one-to-many (1:M) relationships because one parent record can have multiple related operational records. For example, one client can have many campaigns, one campaign can have many projects, and one project can have many assets, clip candidates, render jobs, approval records, and analytics events. The current prototype does not use a direct many-to-many (M:N) relationship. If the final implementation requires multiple staff members to work on the same project with different roles, a junction table such as project_members can be added to resolve the many-to-many relationship between users and projects.

# 6. METHODOLOGY

## 6.1. DEVELOPMENT APPROACH

This project will use the Spiral development model. The Spiral model is suitable because ContentFlow AI contains several connected components, including a web dashboard, mobile module, database backend, AI Generator workflow, Auto Clipper workflow, media processing, rendering, approval tracking, and analytics. Boehm (1988) describes the Spiral model as a risk-driven software process model, which is useful when technical risks and prototype improvements need to be handled in stages.

The Spiral model allows each system component to be planned, developed, tested, and improved in stages. This is important because issues such as file upload errors, AI output quality, database relationship design, mobile usability, rendering failures, and analytics accuracy can be identified early. Therefore, the methodology supports gradual improvement and reduces the risk of leaving major technical problems until the end of the project.

## 6.2. DEVELOPMENT PHASES

### 6.2.1. Planning Phase

The planning phase identifies the problem, target organization, project objectives, scope, target users, and main system requirements. This phase ensures that the project is focused on solving a real digital content management problem in a small social media agency.

### 6.2.2. Analysis Phase

The analysis phase studies the current content production workflow, including client brief handling, asset upload, reference analysis, clipping, rendering, approval, and reporting. The output of this phase includes user requirements, functional requirements, non-functional requirements, and data requirements.

### 6.2.3. Design Phase

The design phase prepares the system architecture, database design, interface design, mobile module design, system flow, use cases, and analytics requirements. This phase also defines the main database entities such as users, clients, campaigns, projects, assets, clip candidates, render jobs, approvals, and analytics events.

### 6.2.4. Development Phase

The development phase builds the prototype. This includes developing the web dashboard, mobile staff module, Supabase integration, asset upload workflow, AI Generator module, Auto Clipper module, rendering workflow, approval tracking, and analytics dashboard.

### 6.2.5. Testing Phase

The testing phase checks whether each function works correctly. It includes testing project creation, asset upload, database storage, AI Generator workflow, Auto Clipper workflow, clip selection, subtitle planning, rendering, mobile responsiveness, approval status updates, and analytics queries.

### 6.2.6. Evaluation Phase

The evaluation phase gathers feedback from at least 10 relevant users. The feedback will be used to evaluate usability, workflow clarity, mobile upload experience, project tracking usefulness, and the overall suitability of the system for managing digital content operations.

## 6.3. TIMELINE

Table 2: Gantt Chart of Project Timeline

[GANTT_TABLE]

# 7. TOOLS AND TECHNOLOGIES

## 7.1. DEVELOPMENT TOOLS

### 7.1.1. Programming Language

JavaScript and TypeScript will be used for the web application, backend logic, and media processing workflow because they support full-stack development and integrate well with Node.js-based tooling.

### 7.1.2. Web Framework

Node.js will be used for the backend/API layer. The existing prototype dashboard may be enhanced using a modern web frontend framework or improved static frontend depending on implementation needs.

### 7.1.3. Mobile Application Tool

The mobile module will be developed using a responsive PWA-style approach. It will be optimized for mobile screens and installable where supported, allowing staff to access upload and review workflows from mobile devices (web.dev, n.d.).

### 7.1.4. Database Management System

Supabase PostgreSQL will be used as the DBMS backend for structured data storage, relational tables, authentication support, storage integration, and analytics querying (Supabase, 2026).

### 7.1.5. Media Processing Tool

FFmpeg will be used for video and audio processing, including metadata extraction, audio extraction, video conversion, and rendering support. FFmpeg is suitable because it can read, filter, and transcode many input and output formats (FFmpeg, n.d.).

### 7.1.6. Rendering Tool

Remotion will be used to render short-form vertical MP4 videos from generated edit plans, subtitles, media assets, and project data. Remotion supports video creation using React and can render MP4 output programmatically (Remotion, n.d.).

### 7.1.7. AI-Assisted Development and Content Services

AI services may be used for transcription, reference analysis, content idea generation, script planning, prompt generation, and highlight candidate selection. These services will support the workflow but will not remove human review.

### 7.1.8. Data Analysis Tool

The analytics dashboard will use Supabase SQL queries and dashboard visualizations. Optional CSV export may be provided for further reporting or analysis.

### 7.1.9. Version Control Tool

Git and GitHub will be used to manage source code, version history, and development progress.

### 7.1.10. Hosting Platform

The prototype may be hosted locally for development and deployed to a suitable web hosting platform during demonstration if required.

## 7.2. JUSTIFICATION

### 7.2.1. JavaScript / TypeScript

JavaScript and TypeScript are suitable because they allow the prototype to share language knowledge across frontend, backend, and workflow logic. This reduces development complexity and supports faster iteration.

### 7.2.2. Node.js

Node.js is suitable for API routes, file handling, workflow execution, and integration with external services. The current prototype already uses Node.js, so continuing with this stack reduces redevelopment risk.

### 7.2.3. PWA-Style Mobile Module

A PWA-style mobile module is suitable because it can provide mobile-friendly and app-like access while remaining connected to the same web backend. This keeps the mobile scope achievable within a student final year project.

### 7.2.4. Supabase PostgreSQL

Supabase PostgreSQL is suitable because it satisfies the DBMS requirement and supports structured relational data. It also provides authentication, storage, APIs, and security features that are useful for a prototype with web and mobile interfaces.

### 7.2.5. FFmpeg

FFmpeg is suitable because the system works heavily with video and audio assets. It supports practical media processing functions needed for clipping, transcoding, extracting audio, and preparing media for rendering.

### 7.2.6. Remotion

Remotion is suitable because it allows videos to be rendered from code. This matches the project requirement to generate structured short-form MP4 outputs from project data, subtitles, and media assets.

### 7.2.7. AI APIs

AI APIs are suitable because the project includes AI-assisted workflows such as analysis, ideation, transcription, and highlight selection. However, the system will still rely on human approval to reduce the risk of unsuitable or inaccurate AI output.

### 7.2.8. GitHub

GitHub is suitable for tracking code changes, managing project versions, and supporting systematic development during the final year project.

# 8. EVALUATION CRITERIA

## 8.1. TESTING METHODS

### 8.1.1. Functional Testing

Functional testing will verify whether the main system functions work correctly. This includes testing login or role access, client creation, campaign creation, project creation, asset upload, AI Generator workflow, Auto Clipper workflow, clip selection, subtitle planning, rendering, approval status updates, and analytics display.

### 8.1.2. Database Testing

Database testing will verify whether records are correctly created, updated, queried, and linked in Supabase PostgreSQL. This includes users, clients, campaigns, projects, assets, clip candidates, render jobs, approvals, and analytics events.

### 8.1.3. Mobile Application Testing

Mobile testing will verify whether the mobile module works properly on phone-sized screens. It will test asset upload, assigned project viewing, clip preview, approval feedback, navigation, and responsive layout.

### 8.1.4. Media Processing Testing

Media processing testing will verify whether reference videos can be analysed, audio can be extracted, transcripts can be generated, highlight candidates can be created, subtitles can be planned, and MP4 files can be rendered.

### 8.1.5. Usability Testing

Usability testing will collect user feedback on dashboard clarity, mobile workflow, upload process, project tracking, clip review, and overall system usefulness. Nielsen (2000) supports small iterative usability tests, and this project will use at least 10 users to provide sufficient academic project feedback.

## 8.2. USER EVALUATION

The prototype will be evaluated by at least 10 relevant users. The target evaluators may include agency staff, content editors, content managers, creators, digital marketing students, or users familiar with social media content workflows.

The evaluation will focus on ease of creating and managing projects, ease of uploading assets through the mobile module, usefulness of AI Generator and Auto Clipper workflows, clarity of approval status, usefulness of analytics, and overall suitability for managing digital content operations.

## 8.3. SUCCESS CRITERIA

1. The web dashboard allows users to manage clients, campaigns, projects, assets, approvals, and rendered outputs.
2. The mobile module allows staff to upload assets and review project outputs from a mobile device.
3. Supabase PostgreSQL stores structured project, asset, workflow, approval, and analytics data.
4. The AI Generator workflow can analyse reference content and generate useful planning outputs.
5. The Auto Clipper workflow can process source videos, generate highlight candidates, and prepare subtitle plans.
6. The rendering workflow can produce MP4 output for short-form content.
7. The analytics dashboard can display useful production metrics from database records.
8. At least 10 users complete the evaluation and provide feedback on usability and workflow suitability.
9. The system demonstrates a clear solution to a digital content management problem, fulfilling CLO1.

# 9. CONCLUSION / JUSTIFICATION

## 9.1. SUMMARY OF PROPOSAL

This proposal presents ContentFlow AI, an AI-assisted content operations management system for a small social media agency. The system is designed to solve problems related to scattered digital assets, manual video workflow, unclear project status, limited mobile upload support, and lack of structured production analytics. The proposal is supported by research and documentation related to digital asset management, short-form video marketing, small business social media management, PWA development, database-backed systems, media processing, programmatic video rendering, and software development methodology.

The proposed system includes a web admin dashboard, mobile staff module, Supabase PostgreSQL database backend, AI Generator workflow, Auto Clipper workflow, rendering workflow, approval tracking, and analytics dashboard. The system manages digital content such as product images, reference videos, scripts, transcripts, subtitles, clip candidates, rendered MP4 files, approval notes, and campaign records.

## 9.2. PROJECT JUSTIFICATION

ContentFlow AI is suitable for ICM658 because it focuses on designing and developing an information system prototype for digital content management in an organization. It is not a rental system, booking system, or simple CRUD system. Instead, it addresses a real content operations problem faced by small social media agencies and includes web, mobile, database, and data analysis components as required by the course outline and capstone briefing (Universiti Teknologi MARA, 2023; Amzari Abu Bakar, 2026).

The project aligns with CLO1 because it designs a solution to a problem in managing digital content. It also supports the wider course requirements because the prototype can be developed into a workable system, tested with users, analysed through database reports, presented, and documented as a final year project. Therefore, ContentFlow AI is justified as an academic and practical final year project for digital information content management.

# 10. REFERENCES

Adobe. (2025). Digital asset management systems: Basics and benefits. https://business.adobe.com/blog/basics/digital-asset-management

Amzari Abu Bakar. (2026). Taklimat ICM658 (Capstone) 20262 [PowerPoint slides]. Universiti Teknologi MARA.

Boehm, B. W. (1988). A spiral model of software development and enhancement. Computer, 21(5), 61-72. https://doi.org/10.1109/2.59

Boehm, B. W., & Hansen, W. J. (2001). The spiral model as a tool for evolutionary acquisition. CrossTalk: The Journal of Defense Software Engineering, 14(5), 4-11.

Coursera. (2026). AI-powered content creation for social media success. https://www.coursera.org/learn/ai-powered-content-creation-for-social-media-success

Crozier, T. (2024). Digital asset management: Guide for video production. AVIXA. https://www.avixa.org/explore/articles/digital-asset-management

FFmpeg. (n.d.). ffmpeg documentation. https://ffmpeg.org/ffmpeg.html

Manic, M. (2024). Short-form video content and consumer engagement in digital landscapes. Bulletin of the Transilvania University of Brasov, Series V: Economic Sciences, 17(66), 1. https://doi.org/10.31926/but.es.2024.17.66.1.4

MDN Web Docs. (2025). Making PWAs installable. https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable

Nielsen, J. (2000). Why you only need to test with 5 users. Nielsen Norman Group. https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/

Remotion. (n.d.). Make videos programmatically. https://www.remotion.dev/

Siems, S., Park, H., Bir, C., & King, A. (2025). Social media marketing for small businesses: A practical guide. Oklahoma State University Extension. https://extension.okstate.edu/fact-sheets/social-media-marketing-for-small-businesses-a-practical-guide

Supabase. (2026). Database overview. https://supabase.com/docs/guides/database/overview

Universiti Teknologi MARA. (2023). ICM658 Digital Information Content Management Project course information.

web.dev. (n.d.). Progressive Web Apps. https://web.dev/explore/progressive-web-apps
