/**
 * Seed-to-Company pipeline.
 *
 * Converts a free-form seed document (business plan, pitch deck, interview)
 * into a fully configured ABF project with agents, teams, knowledge, and workflows.
 *
 * Pipeline stages:
 *   1. Parse  — extractText() pulls plain text from .docx / .pdf / .txt / .md
 *   2. Analyze — (external) sends text to LLM with ANALYZER_SYSTEM_PROMPT → CompanyPlan
 *   3. Apply  — applyCompanyPlan() writes YAML + Markdown files to disk
 */

export * from './types.js';
export * from './parser.js';
export * from './apply.js';
export * from './prompts.js';
export * from './analyzer.js';
export { InterviewEngine } from './interview.js';
