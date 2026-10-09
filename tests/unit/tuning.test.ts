import { describe, it, expect } from 'vitest';
import {
  YAW_PER_PX,
  CAPTURE_TIME,
  RESPAWN_TIME,
  ALLY_RESPAWN,
  BLEEDOUT_TIME,
  REVIVE_TIME,
  GRAVITY,
  PLAYER_R,
  WALL_H,
  VAULT_TIME,
  SLIDE_TIME,
  ZONE_TICKET_COST,
  UAV_TIME,
  TURRET_TIME,
  WALK_SPEED,
  CROUCH_SPEED,
  SPRINT_SPEED,
  SPRINT_SPEED_LIGHTWEIGHT,
  JUMP_VELOCITY,
  COYOTE_TIME,
  JUMP_BUFFER,
  SPRINT_COOLDOWN,
  STAMINA_DRAIN,
  STAMINA_REGEN,
  SLIDE_MIN_SPEED,
  SLIDE_MIN_EXIT_SPEED,
} from '../../src/content/tuning';

describe('tuning constants', () => {
  it('YAW_PER_PX equals index.html:458', () => {
    expect(YAW_PER_PX).toBe(0.0022);
  });

  it('CAPTURE_TIME equals index.html:459', () => {
    expect(CAPTURE_TIME).toBe(7);
  });

  it('RESPAWN_TIME equals index.html:460', () => {
    expect(RESPAWN_TIME).toBe(4);
  });

  it('ALLY_RESPAWN equals index.html:461', () => {
    expect(ALLY_RESPAWN).toBe(20);
  });

  it('BLEEDOUT_TIME equals index.html:462', () => {
    expect(BLEEDOUT_TIME).toBe(12);
  });

  it('REVIVE_TIME equals index.html:463', () => {
    expect(REVIVE_TIME).toBe(2.5);
  });

  it('GRAVITY equals index.html:464', () => {
    expect(GRAVITY).toBe(22);
  });

  it('PLAYER_R equals index.html:465', () => {
    expect(PLAYER_R).toBe(0.35);
  });

  it('WALL_H equals index.html:466', () => {
    expect(WALL_H).toBe(4.2);
  });

  it('VAULT_TIME equals index.html:467', () => {
    expect(VAULT_TIME).toBe(0.35);
  });

  it('SLIDE_TIME equals index.html:468', () => {
    expect(SLIDE_TIME).toBe(0.85);
  });

  it('ZONE_TICKET_COST equals index.html:469', () => {
    expect(ZONE_TICKET_COST).toBe(35);
  });

  it('UAV_TIME equals index.html:470', () => {
    expect(UAV_TIME).toBe(20);
  });

  it('TURRET_TIME equals index.html:471', () => {
    expect(TURRET_TIME).toBe(45);
  });

  it('WALK_SPEED, CROUCH_SPEED, SPRINT_SPEED, SPRINT_SPEED_LIGHTWEIGHT equal index.html:1752', () => {
    expect(WALK_SPEED).toBe(4.9);
    expect(CROUCH_SPEED).toBe(2.3);
    expect(SPRINT_SPEED).toBe(7.4);
    expect(SPRINT_SPEED_LIGHTWEIGHT).toBe(8.6);
  });

  it('JUMP_VELOCITY equals index.html:1766', () => {
    expect(JUMP_VELOCITY).toBe(7.2);
  });

  it('COYOTE_TIME equals index.html:1764', () => {
    expect(COYOTE_TIME).toBe(0.12);
  });

  it('JUMP_BUFFER equals index.html:2987', () => {
    expect(JUMP_BUFFER).toBe(0.12);
  });

  it('SPRINT_COOLDOWN equals index.html:1741', () => {
    expect(SPRINT_COOLDOWN).toBe(0.35);
  });

  it('STAMINA_DRAIN and STAMINA_REGEN equal index.html:1744', () => {
    expect(STAMINA_DRAIN).toBe(0.22);
    expect(STAMINA_REGEN).toBe(0.16);
  });

  it('SLIDE_MIN_SPEED equals index.html:1693', () => {
    expect(SLIDE_MIN_SPEED).toBe(4);
  });

  it('SLIDE_MIN_EXIT_SPEED equals index.html:1695', () => {
    expect(SLIDE_MIN_EXIT_SPEED).toBe(8.5);
  });
});
