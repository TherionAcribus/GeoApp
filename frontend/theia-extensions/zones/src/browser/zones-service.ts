export type ZoneDto = { id: number; name: string; description?: string; created_at?: string };

export class ZonesService {
    constructor(private readonly baseUrl: string) {}

    async list(): Promise<ZoneDto[]> {
        const res = await fetch(`${this.baseUrl}/api/zones`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async create(input: { name: string; description?: string }): Promise<ZoneDto> {
        const res = await fetch(`${this.baseUrl}/api/zones`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(input)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }
}


