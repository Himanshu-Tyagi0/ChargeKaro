"""Geospatial helpers and Delhi-NCR landmark registry."""

import math
from typing import Tuple

DELHI_CENTER = (28.6315, 77.2167)

DELHI_NCR_LANDMARKS: dict[str, Tuple[float, float]] = {
    "connaught place": (28.6315, 77.2167),
    "cp": (28.6315, 77.2167),
    "india gate": (28.6129, 77.2295),
    "saket": (28.5245, 77.2066),
    "nehru place": (28.5494, 77.2501),
    "dwarka": (28.5523, 77.0583),
    "dwarka sector 21": (28.5523, 77.0583),
    "rohini": (28.7041, 77.1025),
    "cyber hub": (28.4950, 77.0890),
    "gurugram": (28.4950, 77.0890),
    "gurgaon": (28.4595, 77.0266),
    "noida": (28.5700, 77.3219),
    "noida sector 18": (28.5700, 77.3219),
    "lajpat nagar": (28.5677, 77.2433),
    "karol bagh": (28.6519, 77.1909),
    "hauz khas": (28.5494, 77.2001),
    "igi airport": (28.5562, 77.1000),
    "airport": (28.5562, 77.1000),
    "t3": (28.5562, 77.1000),
    "new delhi": (28.6139, 77.2090),
    "faridabad": (28.4089, 77.3178),
    "greater noida": (28.4744, 77.5040),
}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate great-circle distance between two coordinates in kilometers."""
    r = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(r * c, 2)


def resolve_place_coords(place: str) -> Tuple[float, float] | None:
    """Resolve a Delhi-NCR area name or 'lat,lng' string to coordinates."""
    text = place.strip().lower()
    if "," in text:
        parts = text.split(",", 1)
        try:
            return float(parts[0].strip()), float(parts[1].strip())
        except ValueError:
            pass
    if text in DELHI_NCR_LANDMARKS:
        return DELHI_NCR_LANDMARKS[text]
    for key, coords in DELHI_NCR_LANDMARKS.items():
        if key in text or text in key:
            return coords
    return None


def point_to_segment_distance_km(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> tuple[float, float]:
    """Return (perpendicular_distance_km, progress_t in [0,1]) from P to segment AB."""
    # Local equirectangular projection around Delhi latitude (~28.6 deg)
    cos_lat = math.cos(math.radians((ax + bx) / 2.0))
    kx = 111.32 * cos_lat
    ky = 110.57

    ax_m, ay_m = ay * kx, ax * ky
    bx_m, by_m = by * kx, bx * ky
    px_m, py_m = py * kx, px * ky

    dx = bx_m - ax_m
    dy = by_m - ay_m
    len_sq = dx * dx + dy * dy
    if len_sq < 1e-6:
        return haversine_km(px, py, ax, ay), 0.0

    t = max(0.0, min(1.0, ((px_m - ax_m) * dx + (py_m - ay_m) * dy) / len_sq))
    proj_x = ax_m + t * dx
    proj_y = ay_m + t * dy
    dist = math.hypot(px_m - proj_x, py_m - proj_y)
    return round(dist, 2), round(t, 3)
