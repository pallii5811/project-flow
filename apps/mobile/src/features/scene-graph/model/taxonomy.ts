/**
 * Controlled taxonomies for Scene Graph V0.
 * Extensible via const arrays — do not invent free-text genres/tropes in fixtures.
 */

export const SCENE_GENRES = [
  "romance",
  "thriller",
  "revenge",
  "fantasy",
  "comedy",
  "crime",
  "mystery",
  "family",
  "drama",
  "action",
] as const;

export type SceneGenre = (typeof SCENE_GENRES)[number];

export const SCENE_TROPES = [
  "betrayal",
  "secret_identity",
  "billionaire",
  "enemies_to_lovers",
  "forced_marriage",
  "revenge",
  "hidden_heir",
  "amnesia",
  "mistaken_identity",
  "second_chance",
  "forbidden_love",
  "power_reversal",
] as const;

export type SceneTrope = (typeof SCENE_TROPES)[number];

export const EMOTIONAL_TONES = [
  "hopeful",
  "tense",
  "sad",
  "angry",
  "romantic",
  "triumphant",
  "shocking",
  "playful",
  "dark",
] as const;

export type EmotionalTone = (typeof EMOTIONAL_TONES)[number];

export const NARRATIVE_BEATS = [
  "setup",
  "reveal",
  "confrontation",
  "betrayal",
  "reversal",
  "escalation",
  "decision",
  "cliffhanger",
  "payoff",
  "resolution",
] as const;

export type NarrativeBeat = (typeof NARRATIVE_BEATS)[number];

export const CHARACTER_ROLES = [
  "protagonist",
  "antagonist",
  "love_interest",
  "supporting",
  "family",
  "friend",
] as const;

export type CharacterRole = (typeof CHARACTER_ROLES)[number];

export const RELATIONSHIP_TYPES = [
  "romantic",
  "family",
  "friendship",
  "rivalry",
  "employer",
  "employee",
  "adversarial",
  "unknown",
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const METADATA_SOURCES = [
  "verified",
  "inferred",
  "generated",
  "humanReviewed",
] as const;

export type MetadataSource = (typeof METADATA_SOURCES)[number];

export const EMOTIONAL_DIRECTIONS = [
  "rising",
  "falling",
  "stable",
  "volatile",
] as const;

export type EmotionalDirection = (typeof EMOTIONAL_DIRECTIONS)[number];

export const SCHEMA_VERSION = 1 as const;

export function isSceneGenre(value: string): value is SceneGenre {
  return (SCENE_GENRES as readonly string[]).includes(value);
}

export function isSceneTrope(value: string): value is SceneTrope {
  return (SCENE_TROPES as readonly string[]).includes(value);
}

export function isEmotionalTone(value: string): value is EmotionalTone {
  return (EMOTIONAL_TONES as readonly string[]).includes(value);
}

export function isNarrativeBeat(value: string): value is NarrativeBeat {
  return (NARRATIVE_BEATS as readonly string[]).includes(value);
}

export function isCharacterRole(value: string): value is CharacterRole {
  return (CHARACTER_ROLES as readonly string[]).includes(value);
}

export function isRelationshipType(value: string): value is RelationshipType {
  return (RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

export function isMetadataSource(value: string): value is MetadataSource {
  return (METADATA_SOURCES as readonly string[]).includes(value);
}
