#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processAiQuery } from './server/ai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) {
    console.error('Usage: node cli.js "Your search query here"');
    console.error('Example: node cli.js "PLSM 이슈 요약해줘"');
    process.exit(1);
  }

  const dbPath = path.join(__dirname, 'data', 'cr_db.json');
  const settingsPath = path.join(__dirname, 'data', 'settings.json');

  let crs = [];
  if (fs.existsSync(dbPath)) {
    const raw = fs.readFileSync(dbPath, 'utf8');
    try {
      crs = JSON.parse(raw);
    } catch (e) {
      console.error('Failed to parse cr_db.json', e);
      process.exit(1);
    }
  } else {
    console.warn('Warning: data/cr_db.json not found. Searching with 0 CRs.');
  }

  let aiConfig = { provider: 'local' };
  let sshConfig = null;
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    try {
      const settings = JSON.parse(raw);
      aiConfig = settings.ai || aiConfig;
      sshConfig = settings.ssh || null;
    } catch (e) {
      console.warn('Failed to parse settings.json, using defaults.');
    }
  }

  // Map aiConfig properties for processAiQuery
  const config = {
    provider: aiConfig.provider,
    apiKey: aiConfig.apiKey,
    customUrl: aiConfig.customUrl,
    customModel: aiConfig.model,
    openaiApiKey: aiConfig.apiKey,
    openaiModel: aiConfig.model,
    geminiApiKey: aiConfig.apiKey,
    geminiModel: aiConfig.model,
    claudeApiKey: aiConfig.apiKey,
    claudeModel: aiConfig.model,
    useDeepAnalysis: false, // Default to false for CLI unless specified
    sshConfig
  };

  console.log(`\n🔍 Searching and Analyzing query: "${query}"`);
  console.log(`🤖 Using Provider: ${config.provider.toUpperCase()} (${config.customModel || config.openaiModel || 'default'})\n`);
  console.log('⏳ Processing (this may take a few seconds)...\n');

  try {
    const result = await processAiQuery({ query, contextCrs: crs, config });
    
    console.log('==================================================');
    console.log('✨ [AI ANALYSIS RESULT]');
    console.log('==================================================\n');
    console.log(result.answer || result.resultText || result.analysis || result.markdown);
    
    console.log('\n==================================================');
    console.log('📁 [MATCHED CRs]');
    if (result.matchedCrs && result.matchedCrs.length > 0) {
      result.matchedCrs.slice(0, 5).forEach((c, idx) => {
        console.log(`${idx + 1}. #${c.crid} [${c.module || 'N/A'}] ${c.cleanSummary}`);
      });
    } else {
      console.log('No matching CRs found.');
    }
    console.log('==================================================\n');

  } catch (err) {
    console.error('Error during AI analysis:', err);
    process.exit(1);
  }
}

run();
