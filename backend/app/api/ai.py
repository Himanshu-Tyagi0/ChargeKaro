"""AI Agents & Voice Assistant REST routes (/api/v1/ai)."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.agents.demand_agent import predict_station_demand
from app.agents.orchestrator import orchestrate_ai_request
from app.agents.recommendation_agent import recommend_chargers
from app.agents.route_agent import plan_ev_route
from app.core.database import get_db
from app.models.user import User
from app.schemas.ai import AIChatRequest, AIChatResponse, RecommendRequest, RoutePlanRequest
from app.security.deps import get_optional_user, limiter
from app.security.middleware import get_client_ip

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/chat", response_model=AIChatResponse)
@limiter.limit("30/minute")
async def ai_chat(
    request: Request,
    payload: AIChatRequest,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    return await orchestrate_ai_request(
        message=payload.message,
        language=payload.language,
        user_lat=payload.user_lat,
        user_lng=payload.user_lng,
        battery_pct=payload.battery_pct or 35,
        confirm_action_id=payload.confirm_action_id,
        db=db,
        user=user,
        ip_address=get_client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", None),
    )


@router.post("/voice-intent", response_model=AIChatResponse)
@limiter.limit("30/minute")
async def ai_voice_intent(
    request: Request,
    payload: AIChatRequest,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    return await orchestrate_ai_request(
        message=payload.message,
        language=payload.language,
        user_lat=payload.user_lat,
        user_lng=payload.user_lng,
        battery_pct=payload.battery_pct or 35,
        confirm_action_id=payload.confirm_action_id,
        db=db,
        user=user,
        ip_address=get_client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", None),
    )


@router.post("/recommend")
@limiter.limit("40/minute")
def ai_recommend(request: Request, payload: RecommendRequest, db: Session = Depends(get_db)):
    recs = recommend_chargers(
        db=db,
        user_lat=payload.user_lat,
        user_lng=payload.user_lng,
        battery_pct=payload.battery_pct,
        connector_type=payload.connector_type,
        urgency=payload.urgency,
        max_price_inr=payload.max_price_inr,
    )
    return {"recommendations": recs}


@router.get("/predict-demand/{station_id}")
def ai_predict_demand(station_id: int, db: Session = Depends(get_db)):
    return predict_station_demand(db, station_id)


@router.post("/plan-route")
@limiter.limit("30/minute")
def ai_plan_route(request: Request, payload: RoutePlanRequest, db: Session = Depends(get_db)):
    return plan_ev_route(
        db=db,
        origin=payload.origin,
        destination=payload.destination,
        battery_pct=payload.battery_pct,
        vehicle_range_km=payload.vehicle_range_km,
        connector_type=payload.connector_type,
    )
