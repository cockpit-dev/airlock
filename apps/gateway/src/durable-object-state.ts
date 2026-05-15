export interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean | void>;
}

export interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
}
