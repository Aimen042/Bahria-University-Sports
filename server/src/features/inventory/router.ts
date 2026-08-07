/**
 * Inventory routes (Feature 4).
 * IMPORTANT: /articles/unpaired and /articles/pair must be registered BEFORE
 * /articles/:id — Express matches routes in registration order, and :id would
 * otherwise swallow the literal path segments.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/async.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import type { ArticleState, ConditionLabel } from '../../db/index.js';
import * as svc from './service.js';
import * as v from './validators.js';
import { z } from 'zod';
import { badRequest } from '../../middleware/errors.js';

export const inventoryRouter = Router();

const staff = [requireAuth, requireRole('SUPER_ADMIN', 'COORDINATOR')] as const;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw badRequest(msg);
  }
  return r.data;
}

function reqId(req: { params: Record<string, string | undefined> }): string {
  const id = req.params.id;
  if (!id) throw badRequest('Missing id');
  return id;
}

// ── Reference ──
inventoryRouter.get('/sport-categories', requireAuth, asyncHandler(async (_req, res) => {
  res.json({ categories: await svc.listSportCategories() });
}));

// ── Equipment types ──
inventoryRouter.get('/types', requireAuth, asyncHandler(async (_req, res) => {
  res.json({ types: await svc.listEquipmentTypes() });
}));

inventoryRouter.post('/types', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.createEquipmentTypeSchema, req.body);
  const created = await svc.createEquipmentType(input);
  res.status(201).json({ type: { equipmentTypeId: created.equipment_type_id, name: created.name } });
}));

inventoryRouter.patch('/types/:id/thresholds', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.updateThresholdsSchema, req.body);
  await svc.updateThresholds(Number(reqId(req)), input);
  res.json({ message: 'Thresholds updated.' });
}));

// ── Availability status (read — any authenticated user) ──
inventoryRouter.get('/status', requireAuth, asyncHandler(async (_req, res) => {
  res.json({ status: await svc.equipmentStatus() });
}));

// ── Articles — literal paths MUST come before /:id ──
inventoryRouter.get('/articles', ...staff, asyncHandler(async (req, res) => {
  const equipmentTypeId = req.query.equipmentTypeId ? Number(req.query.equipmentTypeId) : undefined;
  const state = req.query.state as ArticleState | undefined;
  const condition = req.query.condition as ConditionLabel | undefined;
  res.json({ articles: await svc.listArticles({ equipmentTypeId, state, condition }) });
}));

// MUST be before /articles/:id
inventoryRouter.get('/articles/unpaired', ...staff, asyncHandler(async (req, res) => {
  const equipmentTypeId = req.query.equipmentTypeId ? Number(req.query.equipmentTypeId) : undefined;
  res.json({ articles: await svc.listUnpaired(equipmentTypeId) });
}));

inventoryRouter.post('/articles', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.addArticleSchema, req.body);
  const created = await svc.addArticle(input, req.user!.userId);
  res.status(201).json({ article: created });
}));

// MUST be before /articles/:id
inventoryRouter.post('/articles/pair', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.addArticlePairSchema, req.body);
  const created = await svc.addArticlePair(input, req.user!.userId);
  res.status(201).json({ pairEntry: created });
}));

// Parameterised routes AFTER all literal sub-paths
inventoryRouter.get('/articles/:id', ...staff, asyncHandler(async (req, res) => {
  res.json(await svc.getArticleDetail(reqId(req)));
}));

inventoryRouter.post('/articles/:id/decommission', ...staff, asyncHandler(async (req, res) => {
  await svc.decommissionArticle(reqId(req), req.user!.userId);
  res.json({ message: 'Article decommissioned.' });
}));

inventoryRouter.post('/articles/:id/scan', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.scanSchema, req.body);
  const result = await svc.recordScan(reqId(req), input, req.user!.userId);
  res.json({ ...result, message: 'Scan recorded.' });
}));

inventoryRouter.post('/articles/:id/condition', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.overrideConditionSchema, req.body);
  await svc.overrideCondition(reqId(req), input.label);
  res.json({ message: 'Condition updated.' });
}));

// ── Damage flags ──
inventoryRouter.get('/damage-flags', ...staff, asyncHandler(async (_req, res) => {
  res.json({ flags: await svc.listOpenDamageFlags() });
}));

inventoryRouter.post('/damage-flags/:id/clear', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.clearFlagSchema, req.body);
  await svc.clearDamageFlag(reqId(req), input.label, req.user!.userId);
  res.json({ message: 'Damage flag cleared.' });
}));

// ── Pairs ──
inventoryRouter.post('/pairs', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.formPairSchema, req.body);
  const pair = await svc.formPair(input.articleAId, input.articleBId, req.user!.userId);
  res.status(201).json({ pair: { pairId: pair.pair_id } });
}));

inventoryRouter.post('/pairs/:id/dissolve', ...staff, asyncHandler(async (req, res) => {
  const input = parse(v.dissolvePairSchema, req.body);
  await svc.dissolvePair(reqId(req), input.reason, req.user!.userId);
  res.json({ message: 'Pair dissolved.' });
}));
