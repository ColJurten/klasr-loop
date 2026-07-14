import * as Joi from 'joi';

/** All environment access goes through @nestjs/config with this schema. */
export const configValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(3001),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),
  MONGO_URL: Joi.string().uri().default('mongodb://localhost:27017'),
  ANTHROPIC_API_KEY: Joi.string().allow('').default(''),
});
