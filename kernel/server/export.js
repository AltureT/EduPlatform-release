// 导出（规格 v0.5 §2.6）：GET /api/export.csv，Authorization: Bearer <teacher token>（不接受查询串）
// 单文件长表：stage_id, student_name, key, value, updated_at；每个学生记录按键展开一行（updatedAt 进 updated_at 列）；
// 课程阶段按课堂顺序在前，component:* 等其余 stageId 在后；非标量 value 用 JSON.stringify；UTF-8 带 BOM；不附 students 表。
// 裁决（K1 实现，待确认）：只导出每生记录（perStudent），不导出班级记录（perClass）；updated_at 为 ISO 8601。
import { Router } from 'express';

const HEADER = ['stage_id', 'student_name', 'key', 'value', 'updated_at'];

export function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const isoOf = (ms) => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : '');

export function buildExportCsv(state) {
  const all = state.data.teacherStageData();
  const lessonIds = (state.lessonStages ?? []).map((s) => s.id);
  const ids = [...lessonIds, ...Object.keys(all).filter((id) => !lessonIds.includes(id))];
  const lines = [HEADER.join(',')];
  for (const stageId of ids) {
    const perStudent = all[stageId]?.perStudent ?? {};
    for (const [name, record] of Object.entries(perStudent)) {
      if (!record || typeof record !== 'object') continue;
      const updated = isoOf(record.updatedAt);
      for (const [key, value] of Object.entries(record)) {
        if (key === 'updatedAt') continue;
        lines.push([stageId, name, key, value, updated].map(csvCell).join(','));
      }
    }
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

// tokens：教师 token 集合（auth.js 的 tokens）
export function createExportRouter({ state, tokens }) {
  const router = Router();
  router.get('/export.csv', (req, res) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !tokens.has(token)) return res.status(401).json({ error: 'unauthorized' });
    const safeId = String(state.lessonId ?? '').replace(/[^A-Za-z0-9_-]/g, '') || 'lesson';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeId}-export.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buildExportCsv(state));
  });
  return router;
}
