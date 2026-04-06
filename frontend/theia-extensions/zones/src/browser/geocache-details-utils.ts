export function calculateAntipode(lat: number, lon: number): { lat: number; lon: number } {
    return {
        lat: -lat,
        lon: lon > 0 ? lon - 180 : lon + 180
    };
}

export function calculateProjection(lat: number, lon: number, distance: number, bearing: number): { lat: number; lon: number } {
    const R = 6371000;
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    const bearingRad = bearing * Math.PI / 180;

    const projectedLatRad = Math.asin(
        Math.sin(latRad) * Math.cos(distance / R) +
        Math.cos(latRad) * Math.sin(distance / R) * Math.cos(bearingRad)
    );

    const projectedLonRad = lonRad + Math.atan2(
        Math.sin(bearingRad) * Math.sin(distance / R) * Math.cos(latRad),
        Math.cos(distance / R) - Math.sin(latRad) * Math.sin(projectedLatRad)
    );

    return {
        lat: projectedLatRad * 180 / Math.PI,
        lon: projectedLonRad * 180 / Math.PI
    };
}

export function toGCFormat(lat: number, lon: number): { gcLat: string; gcLon: string } {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    const absLat = Math.abs(lat);
    const absLon = Math.abs(lon);
    const latDeg = Math.floor(absLat);
    const lonDeg = Math.floor(absLon);
    const latMin = ((absLat - latDeg) * 60).toFixed(3);
    const lonMin = ((absLon - lonDeg) * 60).toFixed(3);
    return {
        gcLat: `${latDir} ${latDeg}° ${latMin}`,
        gcLon: `${lonDir} ${lonDeg}° ${lonMin}`
    };
}

export function parseGCCoords(gcLat: string, gcLon: string): { lat: number; lon: number } | null {
    const latMatch = gcLat.match(/([NS])\s*(\d+)°\s*([\d.]+)/);
    const lonMatch = gcLon.match(/([EW])\s*(\d+)°\s*([\d.]+)/);
    if (!latMatch || !lonMatch) {
        return null;
    }
    const lat = (parseInt(latMatch[2]) + parseFloat(latMatch[3]) / 60) * (latMatch[1] === 'S' ? -1 : 1);
    const lon = (parseInt(lonMatch[2]) + parseFloat(lonMatch[3]) / 60) * (lonMatch[1] === 'W' ? -1 : 1);
    return { lat, lon };
}

export function rot13(value: string): string {
    return value.replace(/[a-zA-Z]/g, (char) => {
        const base = char <= 'Z' ? 65 : 97;
        const code = char.charCodeAt(0) - base;
        return String.fromCharCode(((code + 13) % 26) + base);
    });
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function rawTextToHtml(value?: string): string {
    if (!value) {
        return '';
    }
    const escaped = escapeHtml(value);
    return escaped.replace(/\r\n|\n|\r/g, '<br/>');
}

export function htmlToRawText(value?: string): string {
    const html = (value || '').toString();
    if (!html.trim()) {
        return '';
    }
    if (typeof document === 'undefined') {
        return html;
    }
    try {
        const div = document.createElement('div');
        div.innerHTML = html;
        return (div.innerText || div.textContent || '').toString();
    } catch {
        return html;
    }
}
