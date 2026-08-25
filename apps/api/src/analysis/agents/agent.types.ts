export interface Agent<TInput, TOutput> { run(input: TInput): Promise<TOutput>; }

export interface FolderNode { id: string; name: string; path: string; children: FolderNode[]; }
