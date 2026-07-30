import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  process.env.KLASR_WORKER = 'true';
  const app = await NestFactory.createApplicationContext(AppModule);
  process.on('SIGTERM', () => void app.close());
  process.on('SIGINT', () => void app.close());
}

void bootstrap();
