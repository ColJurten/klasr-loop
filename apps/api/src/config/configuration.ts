import * as Joi from 'joi';

/** All environment access goes through @nestjs/config with this schema. */
export const configValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(3001),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),
  MONGO_URL: Joi.string().uri().default('mongodb://localhost:27017'),
  ANTHROPIC_API_KEY: Joi.string().allow('').default(''),
  KLASR_LLM_PROVIDER: Joi.string().allow('').default('local'),
  KLASR_LLM_MODEL: Joi.string().allow('').default(''),
  KLASR_LLM_API_KEY: Joi.string().allow('').default(''),
  KLASR_LLM_BASE_URL: Joi.string().allow('').default(''),
  KLASR_LLM_ALLOWED_ORIGINS: Joi.string().allow('').default(''),
  KLASR_LLM_TIMEOUT_MS: Joi.number().integer().min(100).max(60000).default(10000),
  KLASR_AGENT_ANALYSE_MODEL: Joi.string().allow('').default(''),
  KLASR_AGENT_FILENAME_MODEL: Joi.string().allow('').default(''),
  KLASR_AGENT_DESTINATION_MODEL: Joi.string().allow('').default(''),
  KLASR_FILENAME_CONVENTION: Joi.string().allow('').default('YYYY-MM-DD_type_party_reference'),
  INTERNAL_API_SECRET: Joi.string().allow('').default(''),
  TOKEN_ENCRYPTION_KEY: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
  KLASR_LOCAL_MVP: Joi.string().valid('true', 'false').default('false'),
  KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: Joi.string().valid('true', 'false').default('false'),
  KLASR_GOOGLE_SERVICE_ACCOUNT_FILE: Joi.string().allow('').default(''),
  KLASR_GOOGLE_DRIVE_ROOT_ID: Joi.string().allow('').default(''),
  KLASR_INLINE_WORKER: Joi.string().valid('true', 'false').default('false'),
});
