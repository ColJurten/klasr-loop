/**
 * NoSQL data-access component (REAC C8, ADR-002). MongoDB holds ONE collection:
 * raw analysis payloads (OCR excerpt + LLM responses) whose shape varies by
 * provider. A TTL index purges them automatically (RGPD + eco-design).
 * Tenant scoping applies here exactly as in the SQL repositories.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Collection, MongoClient } from 'mongodb';

export interface AnalysisRecord {
  organizationId: string;
  documentId: string;
  ocrExcerpt?: string;
  llmRaw?: Record<string, unknown>;
  modelUsed?: string;
  createdAt: Date;
}

const TTL_DAYS = 30;

@Injectable()
export class AnalysesRepository implements OnModuleDestroy {
  private client: MongoClient | null = null;
  private collection: Collection<AnalysisRecord> | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Lazy connection: the API boots and tests run without a Mongo instance. */
  private async getCollection(): Promise<Collection<AnalysisRecord>> {
    if (this.collection) return this.collection;
    const url = this.config.get<string>('MONGO_URL') ?? 'mongodb://localhost:27017';
    this.client = new MongoClient(url);
    await this.client.connect();
    this.collection = this.client.db('klasr').collection<AnalysisRecord>('analyses');
    await this.collection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: TTL_DAYS * 24 * 3600 },
    );
    await this.collection.createIndex({ organizationId: 1, documentId: 1 });
    return this.collection;
  }

  async record(analysis: Omit<AnalysisRecord, 'createdAt'>): Promise<void> {
    const collection = await this.getCollection();
    await collection.insertOne({ ...analysis, createdAt: new Date() });
  }

  async findByDocument(organizationId: string, documentId: string): Promise<AnalysisRecord[]> {
    const collection = await this.getCollection();
    return collection.find({ organizationId, documentId }).sort({ createdAt: -1 }).toArray();
  }

  async purgeOrganization(organizationId: string): Promise<number> {
    const collection = await this.getCollection();
    const result = await collection.deleteMany({ organizationId });
    return result.deletedCount;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }
}
