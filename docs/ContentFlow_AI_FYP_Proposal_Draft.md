# FACULTY OF INFORMATION SCIENCE

# CAMPUS OF PUNCAK PERDANA

# BACHELOR OF INFORMATION SCIENCE (HONS.) INFORMATION CONTENT MANAGEMENT (CDIM263)

# ICM658 - DIGITAL INFORMATION CONTENT MANAGEMENT PROJECT

## PROPOSAL TITLE:

# CONTENTFLOW AI: AI-ASSISTED CONTENT OPERATIONS MANAGEMENT SYSTEM FOR A SMALL SOCIAL MEDIA AGENCY

## PREPARED FOR:

[Supervisor / Lecturer Name]

## PREPARED BY:

[Student Name] ([Student ID])

## GROUP:

[Group]

## SUBMISSION DATE:

[Submission Date]

\pagebreak

# ACKNOWLEDGEMENT

Alhamdulillah, first and foremost, I am grateful to Allah S.W.T. for giving me the strength, time, and opportunity to prepare this project proposal for ICM658 - Digital Information Content Management Project.

I would like to express my appreciation to my lecturer and supervisor for the guidance, feedback, and explanation provided throughout the proposal preparation process. Their direction helped me understand the capstone project requirements, especially the need to design a practical information system prototype that includes web programming, mobile application development, database design, and data analysis for digital content management.

I would also like to thank my family, friends, and all individuals who supported me directly or indirectly during the preparation of this proposal. Their support has helped me refine the project idea and align it with the course learning outcome, especially CLO1, which focuses on designing a solution to a problem in managing digital content.

\pagebreak

# TABLE OF CONTENTS

1. Problem Statement
   1.1 Background of the Problem
   1.2 Problem Identification
   1.3 Importance of the Problem
2. Objectives
   2.1 General Objective
   2.2 Specific Objectives (SMART)
3. Target Users and Use Cases
   3.1 Target Users
   3.2 Use Case Scenarios
4. Scope of the Prototype
   4.1 In Scope
   4.2 Out of Scope
5. System Overview / Architecture
   5.1 System Overview
   5.2 System Architecture
   5.3 System Flow
6. Methodology
   6.1 Development Approach
   6.2 Development Phases
   6.3 Timeline
7. Tools and Technologies
   7.1 Development Tools
   7.2 Justification
8. Evaluation Criteria
   8.1 Testing Methods
   8.2 User Evaluation
   8.3 Success Criteria
9. Conclusion / Justification
   9.1 Summary of Proposal
   9.2 Project Justification
10. References

\pagebreak

# 1. PROBLEM STATEMENT

## 1.1 Background of the Problem

Social media content has become an important digital asset for small and medium enterprises (SMEs), especially for businesses that depend on platforms such as TikTok, Instagram Reels, Facebook Reels, and YouTube Shorts to reach customers. A small social media or content marketing agency usually manages many forms of digital content for different clients, including product images, reference videos, long-form videos, short clips, captions, scripts, transcripts, subtitles, rendered MP4 files, campaign folders, and approval notes.

Although the content produced by these agencies is digital, the operational workflow is often scattered across different tools. For example, client briefs may be discussed through WhatsApp, product images may be stored in Google Drive, reference links may be saved in Telegram or spreadsheets, video drafts may be reviewed manually, and final files may be delivered through separate cloud links. This situation makes it difficult for managers, editors, and reviewers to monitor the status of each content project in one structured system.

The ICM658 course requires students to design and build an information system prototype for managing digital content in an organization. The course also highlights major components such as web programming, mobile app development, database design, and data analysis from the completed prototype (UiTM, 2023). Therefore, this project proposes ContentFlow AI, an AI-assisted content operations management system for a small social media agency. The system is designed to manage content projects, organize digital media assets, support AI-assisted reference analysis and clipping, render short-form videos, and provide production analytics through a structured database-backed workflow.

## 1.2 Problem Identification

The main problem is that small social media agencies often manage content production using disconnected tools and manual workflows. Client assets, reference videos, campaign briefs, generated scripts, highlight clips, review feedback, and final rendered videos may be spread across WhatsApp, Google Drive, local folders, spreadsheets, editing software, and separate communication channels. This makes the digital content workflow difficult to track and manage.

Several specific problems can be identified:

1. Digital content assets are scattered across multiple platforms, causing duplicated files, lost references, and difficulty locating the latest version of a project.
2. Managers cannot easily monitor project status, staff assignments, approval progress, generated clips, and final rendered outputs in real time.
3. Editors spend time manually analysing reference videos, identifying highlight moments, preparing subtitles, and rendering short-form content.
4. Staff members may not have a simple mobile workflow for uploading product assets, reference materials, or reaction character files while working outside the office.
5. Production data such as number of projects, videos rendered, clip candidates generated, project completion status, and staff activity is not stored in a structured DBMS for later analysis.

Without a proper information system, the agency may face slower production, weak project visibility, inconsistent file organization, and limited ability to evaluate content output performance.

## 1.3 Importance of the Problem

This problem is important because short-form video production depends on speed, organization, and repeated collaboration between managers, editors, staff, and clients. A small agency may handle several clients at the same time, and each client may require multiple content outputs for different campaigns. If the workflow is not structured, the agency may lose time searching for assets, checking approval status, repeating manual editing tasks, or compiling reports manually.

A system is needed to manage digital content assets and production workflows more efficiently. ContentFlow AI addresses this need by combining content operations management, AI-assisted content generation, auto-clipping, subtitle planning, rendering, approval tracking, and analytics in one prototype. The system directly supports CLO1 because it designs a solution to a problem in managing digital content. It also prepares the foundation for CLO2, CLO3, and CLO4 because the proposed solution can be developed into a working prototype, presented, and documented as a final project.

\pagebreak

# 2. OBJECTIVES

## 2.1 General Objective

To design and develop ContentFlow AI, an AI-assisted content operations management system that helps a small social media agency manage client content projects, digital assets, AI-generated content workflows, short-form video clipping, approval status, and production analytics through a web dashboard, mobile staff module, and Supabase PostgreSQL database backend.

## 2.2 Specific Objectives (SMART)

The specific objectives are:

1. To design and develop a web-based admin dashboard that allows agency managers to create clients, campaigns, projects, folders, staff assignments, approval statuses, and rendered content records by the end of the prototype development phase.
2. To design and develop a mobile app module using a responsive installable PWA approach that allows staff to upload product images, reference videos, reaction character assets, and review project outputs using mobile devices.
3. To implement a Supabase PostgreSQL database backend that stores users, organizations, clients, campaigns, projects, assets, clip candidates, render jobs, approval records, and analytics events in a structured DBMS.
4. To integrate AI-assisted content production features that support reference video analysis, content idea generation, script planning, highlight candidate generation, subtitle planning, and final MP4 rendering.
5. To develop an analytics dashboard or reporting view that displays production data such as total projects, videos rendered, clip candidates generated, project status, staff upload activity, and monthly production trends.
6. To evaluate the prototype through functional testing, database testing, mobile workflow testing, and usability testing with at least 10 relevant users such as agency staff, editors, managers, content creators, or student testers.

\pagebreak

# 3. TARGET USERS AND USE CASES

## 3.1 Target Users

### 3.1.1 Agency Administrator / Manager

The agency administrator or manager is responsible for managing the overall content production workflow. This user creates clients, campaigns, and content projects, assigns staff, monitors project progress, reviews generated outputs, checks approval status, and views production analytics.

### 3.1.2 Content Editor

The content editor uses the system to manage reference videos, product materials, generated scripts, highlight candidates, subtitle plans, and rendered MP4 outputs. The editor may run AI-assisted analysis, choose suitable clip candidates, render final videos, and prepare content for review.

### 3.1.3 Mobile Staff / Content Assistant

Mobile staff or content assistants use the mobile module to upload product images, reference links, reaction character files, or supporting campaign materials. They may also review generated clips and submit quick feedback from a mobile device.

### 3.1.4 Client Reviewer / Internal Reviewer

The reviewer checks generated clips, subtitles, and rendered videos before final delivery. The reviewer can provide approval feedback and help ensure that the content is suitable for the campaign objective.

## 3.2 Use Case Scenarios

### 3.2.1 Use Case 1: Manager Creates a Client Campaign

The manager logs in to the web dashboard, creates a client profile, adds a campaign, sets the campaign objective, and creates a new content project. The project is assigned to an editor and linked to the correct client and campaign record.

### 3.2.2 Use Case 2: Staff Uploads Product and Reference Assets

The staff member opens the mobile module, selects the assigned project, and uploads product images, reference videos, or reaction character files. The uploaded files are stored as project assets and linked to the related project record in the database.

### 3.2.3 Use Case 3: Editor Uses AI Generator Workflow

The editor uploads a reference video and product or character assets. The system analyses the reference video, extracts metadata, generates a style blueprint, suggests content ideas, prepares a script plan, creates image or video prompts, and supports rendering a short-form video.

### 3.2.4 Use Case 4: Editor Uses Auto Clipper Workflow

The editor submits a long-form video or video link. The system processes the video, transcribes the audio, identifies highlight candidates, generates subtitle plans, and allows the editor to select a highlight for rendering into a short-form MP4 clip.

### 3.2.5 Use Case 5: Reviewer Approves or Requests Changes

The reviewer opens the project, views the generated clip or final rendered MP4, and updates the approval status. If changes are needed, the reviewer submits feedback for the editor to revise the output.

### 3.2.6 Use Case 6: Manager Views Analytics

The manager opens the analytics dashboard to view production statistics such as number of projects created, rendered videos, active campaigns, approval status breakdown, average render activity, and monthly production trends.

\pagebreak

# 4. SCOPE OF THE PROTOTYPE

## 4.1 In Scope

### 4.1.1 Web Admin Dashboard

The prototype will include a web-based admin dashboard for managing clients, campaigns, folders, projects, staff assignments, approval status, AI Generator projects, Auto Clipper projects, rendered videos, and analytics.

### 4.1.2 Mobile App Module

The prototype will include a mobile app module using a responsive installable PWA approach. This module will focus on staff upload and review workflows, including asset upload, assigned project viewing, clip preview, and approval feedback.

### 4.1.3 Supabase PostgreSQL Database

The prototype will use Supabase PostgreSQL as the DBMS backend. The database will store structured records for users, organizations, clients, campaigns, projects, assets, clip candidates, render jobs, approval feedback, and analytics events.

### 4.1.4 AI Generator Module

The AI Generator module will support reference video analysis, metadata extraction, transcript generation, style analysis, content idea generation, script planning, image prompt generation, video prompt generation, and final edit plan preparation.

### 4.1.5 Auto Clipper Module

The Auto Clipper module will support source video input, video download or upload, audio extraction, transcription, highlight candidate generation, clip selection, subtitle planning, and final clip rendering.

### 4.1.6 Rendering and Subtitle Output

The system will support MP4 rendering using Remotion and FFmpeg-based media processing. It will also support subtitle planning and display for short-form vertical video outputs.

### 4.1.7 Analytics Dashboard

The prototype will include analytics views that query production data from Supabase. The analytics may include project totals, project types, render counts, approval status, staff upload activity, clip candidate counts, and monthly production trends.

### 4.1.8 User Evaluation

The prototype will be tested with at least 10 relevant users, such as agency staff, editors, content managers, creators, or student testers, to evaluate usability and workflow clarity.

## 4.2 Out of Scope

### 4.2.1 Full Social Media Scheduling

The prototype will not include full social media scheduling or direct posting to TikTok, Instagram, Facebook, or YouTube.

### 4.2.2 Advanced Client Billing

The prototype will not include payment processing, invoicing, subscription billing, or advanced client account billing.

### 4.2.3 Full Cloud Rendering Infrastructure

The prototype will not implement a large-scale cloud rendering queue. Local or limited server-side rendering is sufficient for the academic prototype.

### 4.2.4 Advanced AI Model Training

The project will not train a custom AI model. It will use existing AI APIs or rule-based fallback logic for analysis, generation, transcription, and highlight selection.

### 4.2.5 Public Marketplace Platform

The prototype will not function as a public marketplace for creators or agencies. It is designed for one small agency's internal content operations.

### 4.2.6 Complex Enterprise Role Management

The prototype will include basic user roles such as admin, editor, staff, and reviewer. Advanced enterprise permissions, department hierarchy, and audit governance are outside the prototype scope.

\pagebreak

# 5. SYSTEM OVERVIEW / ARCHITECTURE

## 5.1 System Overview

ContentFlow AI is a web and mobile-based information system for managing digital content production in a small social media agency. The system helps the agency organize clients, campaigns, content projects, uploaded assets, AI-assisted generation workflows, auto-clipping workflows, rendered videos, approval status, and production analytics.

The existing prototype foundation already includes a local Node.js dashboard, project folder structure, AI Generator workflow, Auto Clipper workflow, FFmpeg media processing, Remotion rendering, and sample rendered MP4 outputs. For the final year project, the system will be reframed and extended as a full content operations management system with Supabase PostgreSQL database storage and a mobile staff module.

## 5.2 System Architecture

ContentFlow AI consists of five main layers: frontend, mobile module, backend/API layer, database/storage layer, and media processing layer.

### 5.2.1 Frontend Web Dashboard

The web dashboard will be used by administrators, managers, and editors. It will include project management, client management, campaign management, asset management, AI Generator controls, Auto Clipper controls, render preview, approval status, and analytics views.

### 5.2.2 Mobile Staff Module

The mobile module will be designed as a responsive installable PWA-style mobile app. It will allow staff to access assigned projects, upload assets from mobile devices, preview generated clips, and submit review feedback. Progressive Web Apps can provide app-like experiences and can be installable on supported devices when they meet installability criteria (web.dev, n.d.; MDN, 2025).

### 5.2.3 Backend/API Layer

The backend will manage API requests for project creation, asset upload, AI workflow execution, clipping, rendering, approval updates, and analytics queries. The existing Node.js backend will be adapted to communicate with Supabase and the media processing services.

### 5.2.4 Supabase PostgreSQL Database

Supabase will be used as the DBMS backend because every Supabase project includes a full PostgreSQL database, and it also supports authentication, storage, APIs, and row-level security (Supabase, 2026). The database will store structured records related to users, clients, campaigns, projects, digital assets, clip candidates, render jobs, approval feedback, and analytics events.

### 5.2.5 Media Processing Layer

The media processing layer will handle video metadata extraction, audio extraction, transcription, reference analysis, content generation, highlight selection, subtitle planning, and MP4 rendering. It will use technologies such as Node.js, FFmpeg, Remotion, and AI APIs where applicable.

## 5.3 System Flow

Figure 1: ContentFlow AI System Flow

The system flow is as follows:

1. Manager creates a client and campaign.
2. Manager creates a content project and assigns staff or editor.
3. Staff uploads product images, reference videos, reaction character files, or source links through the mobile module.
4. Editor selects either AI Generator or Auto Clipper workflow.
5. For AI Generator, the system analyses the reference video, generates style analysis, content ideas, script plan, prompts, and edit plan.
6. For Auto Clipper, the system analyses a long-form video, generates transcript, identifies highlight candidates, creates subtitle plan, and prepares clip selection.
7. Editor renders the final short-form MP4 output.
8. Reviewer checks the generated output and updates approval status.
9. Manager monitors project progress and production analytics from the dashboard.
10. Final rendered content is prepared for client delivery or social media posting.

\pagebreak

# 6. METHODOLOGY

## 6.1 Development Approach

This project will use the Spiral development model. The Spiral model is suitable because ContentFlow AI contains several connected components, including a web dashboard, mobile module, database backend, AI Generator workflow, Auto Clipper workflow, media processing, rendering, approval tracking, and analytics. The project also involves technical risks such as video processing errors, AI output quality, file upload handling, database design, mobile usability, and render performance.

The Spiral model supports iterative development, risk analysis, prototyping, testing, and improvement. Each cycle can focus on a different part of the system, such as database design, asset upload, AI workflow, clipping workflow, rendering, approval tracking, and analytics. This approach helps ensure that the final prototype remains practical, testable, and aligned with the ICM658 capstone requirement.

## 6.2 Development Phases

### 6.2.1 Planning Phase

The planning phase identifies the problem, target organization, project objectives, scope, target users, and main system requirements. This phase ensures that the project is focused on solving a real digital content management problem in a small social media agency.

### 6.2.2 Analysis Phase

The analysis phase studies the current content production workflow, including client brief handling, asset upload, reference analysis, clipping, rendering, approval, and reporting. The output of this phase includes user requirements, functional requirements, non-functional requirements, and data requirements.

### 6.2.3 Design Phase

The design phase prepares the system architecture, database design, interface design, mobile module design, system flow, use cases, and analytics requirements. This phase also defines the main database entities such as users, clients, campaigns, projects, assets, clip candidates, render jobs, approvals, and analytics events.

### 6.2.4 Development Phase

The development phase builds the prototype. This includes developing the web dashboard, mobile staff module, Supabase integration, asset upload workflow, AI Generator module, Auto Clipper module, rendering workflow, approval tracking, and analytics dashboard.

### 6.2.5 Testing Phase

The testing phase checks whether each function works correctly. It includes testing project creation, asset upload, database storage, AI Generator workflow, Auto Clipper workflow, clip selection, subtitle planning, rendering, mobile responsiveness, approval status updates, and analytics queries.

### 6.2.6 Evaluation Phase

The evaluation phase gathers feedback from at least 10 relevant users. The feedback will be used to evaluate usability, workflow clarity, mobile upload experience, project tracking usefulness, and the overall suitability of the system for managing digital content operations.

## 6.3 Timeline

Table 1: Gantt Chart of Project Timeline

| Task | Week 1 | Week 2 | Week 3 | Week 4 | Week 5 | Week 6 | Week 7 | Week 8 | Week 9 | Week 10 | Week 11 | Week 12 | Week 13 | Week 14 | Week 15 | Week 16 | Week 17 | Week 18 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Problem identification and proposal planning | X | X | X | X | X |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Requirement analysis and target user study |  | X | X | X | X |  |  |  |  |  |  |  |  |  |  |  |  |  |
| System architecture and database design |  |  | X | X | X | X |  |  |  |  |  |  |  |  |  |  |  |  |
| Web dashboard interface design |  |  |  | X | X | X | X |  |  |  |  |  |  |  |  |  |  |  |
| Mobile module interface design |  |  |  | X | X | X | X |  |  |  |  |  |  |  |  |  |  |  |
| Supabase database setup and API integration |  |  |  |  |  | X | X | X | X |  |  |  |  |  |  |  |  |  |
| Client, campaign, project, and asset management |  |  |  |  |  |  | X | X | X | X |  |  |  |  |  |  |  |  |
| AI Generator module development |  |  |  |  |  |  |  | X | X | X | X |  |  |  |  |  |  |  |
| Auto Clipper module development |  |  |  |  |  |  |  | X | X | X | X | X |  |  |  |  |  |  |
| Mobile upload and review workflow |  |  |  |  |  |  |  |  | X | X | X | X |  |  |  |  |  |  |
| Rendering and subtitle workflow |  |  |  |  |  |  |  |  |  | X | X | X | X |  |  |  |  |  |
| Analytics dashboard and reporting |  |  |  |  |  |  |  |  |  |  | X | X | X | X |  |  |  |  |
| Functional, database, and mobile testing |  |  |  |  |  |  |  |  |  |  |  | X | X | X | X |  |  |  |
| User evaluation and improvement |  |  |  |  |  |  |  |  |  |  |  |  | X | X | X | X |  |  |
| Final report, documentation, and presentation |  |  |  |  |  |  |  |  |  |  |  |  |  | X | X | X | X | X |

\pagebreak

# 7. TOOLS AND TECHNOLOGIES

## 7.1 Development Tools

### 7.1.1 Programming Language

JavaScript and TypeScript will be used for the web application, backend logic, and media processing workflow.

### 7.1.2 Web Framework

Node.js will be used for the backend/API layer. The existing prototype dashboard may be enhanced using a modern web frontend framework or improved static frontend depending on implementation needs.

### 7.1.3 Mobile Application Tool

The mobile module will be developed using a responsive PWA-style approach. It will be optimized for mobile screens and installable where supported, allowing staff to access upload and review workflows from mobile devices.

### 7.1.4 Database Management System

Supabase PostgreSQL will be used as the DBMS backend for structured data storage, relational tables, authentication support, storage integration, and analytics querying.

### 7.1.5 Media Processing Tools

FFmpeg will be used for video and audio processing, including metadata extraction, audio extraction, video conversion, and rendering support.

### 7.1.6 Rendering Tool

Remotion will be used to render short-form vertical MP4 videos from generated edit plans, subtitles, media assets, and project data.

### 7.1.7 AI Services

AI services may be used for transcription, reference analysis, content idea generation, script planning, prompt generation, and highlight candidate selection. Fallback rule-based logic may be used when AI services are unavailable.

### 7.1.8 Data Analysis Tool

The analytics dashboard will use Supabase SQL queries and dashboard visualizations. Optional CSV export may be provided for further reporting or analysis using spreadsheet/data analysis tools.

### 7.1.9 Version Control Tool

Git and GitHub will be used to manage source code, version history, and development progress.

### 7.1.10 Hosting / Deployment Tool

The prototype may be hosted locally for development and deployed to a suitable web hosting platform during demonstration if required.

## 7.2 Justification

### 7.2.1 JavaScript / TypeScript

JavaScript and TypeScript are suitable because they can support frontend, backend, API, and media workflow development in one consistent ecosystem.

### 7.2.2 Node.js

Node.js is suitable for building backend APIs, handling file uploads, managing workflow execution, and integrating with media processing tools and external APIs.

### 7.2.3 PWA-Style Mobile Module

A PWA-style mobile module is suitable because it can provide an app-like mobile experience, support responsive design, and allow installation on supported devices while sharing the same web technology foundation.

### 7.2.4 Supabase PostgreSQL

Supabase PostgreSQL is suitable because it provides a relational DBMS backend, supports structured tables and relationships, and includes useful features such as authentication, storage, APIs, and security policies.

### 7.2.5 FFmpeg

FFmpeg is suitable because video production workflows require video conversion, audio extraction, metadata analysis, and file processing. These functions are important for both the AI Generator and Auto Clipper modules.

### 7.2.6 Remotion

Remotion is suitable because it allows videos to be rendered programmatically from React-based compositions. This supports consistent short-form content generation with subtitles, images, videos, and layout control.

### 7.2.7 AI APIs

AI APIs are suitable because the project involves AI-assisted analysis and content operations. They can help reduce manual work in analysing reference videos, generating scripts, identifying highlights, and preparing subtitle plans.

### 7.2.8 GitHub

GitHub is suitable for tracking code changes, managing project versions, and supporting systematic development during the final year project.

\pagebreak

# 8. EVALUATION CRITERIA

## 8.1 Testing Methods

### 8.1.1 Functional Testing

Functional testing will verify whether the main system functions work correctly. This includes testing login or role access, client creation, campaign creation, project creation, asset upload, AI Generator workflow, Auto Clipper workflow, clip selection, subtitle planning, rendering, approval status updates, and analytics display.

### 8.1.2 Database Testing

Database testing will verify whether records are correctly created, updated, queried, and linked in Supabase PostgreSQL. This includes users, clients, campaigns, projects, assets, clip candidates, render jobs, approvals, and analytics events.

### 8.1.3 Mobile Module Testing

Mobile testing will verify whether the mobile module works properly on phone-sized screens. It will test asset upload, assigned project viewing, clip preview, approval feedback, navigation, and responsive layout.

### 8.1.4 Media Processing Testing

Media processing testing will verify whether reference videos can be analysed, audio can be extracted, transcripts can be generated, highlight candidates can be created, subtitles can be planned, and MP4 files can be rendered.

### 8.1.5 Usability Testing

Usability testing will collect user feedback on dashboard clarity, mobile workflow, upload process, project tracking, clip review, and overall system usefulness.

## 8.2 User Evaluation

The prototype will be evaluated by at least 10 relevant users. The target evaluators may include agency staff, content editors, content managers, creators, digital marketing students, or users familiar with social media content workflows.

The evaluation will focus on:

1. Ease of creating and managing content projects.
2. Ease of uploading assets through the mobile module.
3. Usefulness of AI Generator and Auto Clipper workflows.
4. Clarity of approval status and review feedback.
5. Usefulness of analytics dashboard for monitoring production.
6. Overall suitability of the system for managing digital content operations.

## 8.3 Success Criteria

The prototype will be considered successful if:

1. The web dashboard allows users to manage clients, campaigns, projects, assets, approvals, and rendered outputs.
2. The mobile module allows staff to upload assets and review project outputs from a mobile device.
3. Supabase PostgreSQL stores structured project, asset, workflow, approval, and analytics data.
4. The AI Generator workflow can analyse reference content and generate useful planning outputs.
5. The Auto Clipper workflow can process source videos, generate highlight candidates, and prepare subtitle plans.
6. The rendering workflow can produce MP4 output for short-form content.
7. The analytics dashboard can display useful production metrics from database records.
8. At least 10 users complete the evaluation and provide feedback on usability and workflow suitability.
9. The system demonstrates a clear solution to a digital content management problem, fulfilling CLO1.

\pagebreak

# 9. CONCLUSION / JUSTIFICATION

## 9.1 Summary of Proposal

This proposal presents ContentFlow AI, an AI-assisted content operations management system for a small social media agency. The system is designed to solve problems related to scattered digital assets, manual video workflow, unclear project status, limited mobile upload support, and lack of structured production analytics.

The proposed system includes a web admin dashboard, mobile staff module, Supabase PostgreSQL database backend, AI Generator workflow, Auto Clipper workflow, rendering workflow, approval tracking, and analytics dashboard. The system manages digital content such as product images, reference videos, scripts, transcripts, subtitles, clip candidates, rendered MP4 files, approval notes, and campaign records.

## 9.2 Project Justification

ContentFlow AI is suitable for ICM658 because it focuses on designing and developing an information system prototype for digital content management in an organization. It is not a rental system, booking system, or simple CRUD system. Instead, it addresses a real content operations problem faced by small social media agencies and includes web, mobile, database, and data analysis components.

The project aligns with CLO1 because it designs a solution to a problem in managing digital content. It also supports the wider course requirements because the prototype can be developed into a workable system, tested with users, analysed through database reports, presented, and documented as a final year project.

\pagebreak

# 10. REFERENCES

Boehm, B. W. (1988). A spiral model of software development and enhancement. Computer, 21(5), 61-72.

Boehm, B. W., & Hansen, W. J. (2001). The spiral model as a tool for evolutionary acquisition. CrossTalk: The Journal of Defense Software Engineering, 14(5), 4-11.

MDN Web Docs. (2025). Making PWAs installable. https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable

Supabase. (2026). Database overview. https://supabase.com/docs/guides/database/overview

Supabase. (2026). Supabase documentation. https://supabase.com/docs

Universiti Teknologi MARA. (2023). ICM658 Digital Information Content Management Project course information.

web.dev. (n.d.). Progressive Web Apps. https://web.dev/explore/progressive-web-apps

web.dev. (n.d.). What are Progressive Web Apps? https://web.dev/articles/what-are-pwas

