export class FixedCapacityRingBuffer<T> {
	private readonly values: Array<T | undefined>;
	private head = 0;
	private tail = 0;
	private _size = 0;

	constructor(readonly capacity: number) {
		if (!Number.isInteger(capacity) || capacity <= 0) {
			throw new RangeError("Ring buffer capacity must be a positive integer.");
		}
		this.values = new Array<T | undefined>(capacity);
	}

	get size(): number {
		return this._size;
	}

	append(value: T): void {
		this.values[this.tail] = value;
		this.tail = (this.tail + 1) % this.capacity;

		if (this._size === this.capacity) {
			this.head = this.tail;
		} else {
			this._size += 1;
		}
	}

	toArray(): T[] {
		const snapshot = new Array<T>(this._size);
		for (let index = 0; index < this._size; index += 1) {
			snapshot[index] = this.values[(this.head + index) % this.capacity] as T;
		}
		return snapshot;
	}

	clear(): void {
		this.values.fill(undefined);
		this.head = 0;
		this.tail = 0;
		this._size = 0;
	}
}
