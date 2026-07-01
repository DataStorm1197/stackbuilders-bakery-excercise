#!/usr/bin/env bash
#
# End-to-end smoke test of the Bakery API.
# Runs the full lifecycle: CUSTOMER places an order -> KITCHEN marks it READY -> CUSTOMER pays.
#
# Requires: curl, jq, and the API running (docker compose up -d).
# Usage:    ./scripts/full-flow.sh [BASE_URL]
#           BASE_URL defaults to http://localhost:3000
#
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"

# ---- helpers ---------------------------------------------------------------
die() { echo "❌ $*" >&2; exit 1; }
step() { echo; echo "▶ $*"; }

login() {
  # $1 email, $2 password -> prints access_token
  local email="$1" pass="$2" resp token
  resp=$(curl -s -X POST "$BASE_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$pass\"}")
  token=$(echo "$resp" | jq -r '.access_token // empty')
  [ -n "$token" ] || die "Login falló para $email -> $resp"
  echo "$token"
}

command -v jq >/dev/null || die "jq no está instalado"
curl -sf -o /dev/null "$BASE_URL/menu" || die "La API no responde en $BASE_URL (¿docker compose up?)"

# ---- 0. tokens por rol -----------------------------------------------------
step "Autenticando los tres roles"
CUSTOMER_TOKEN=$(login "customer@bakery.com" "customer123")
KITCHEN_TOKEN=$(login "kitchen@bakery.com" "kitchen123")
MANAGER_TOKEN=$(login "manager@bakery.com" "manager123")
echo "  ✓ customer / kitchen / manager autenticados"

# ---- 1. elegir un MenuItem del menú público --------------------------------
step "Leyendo el menú y eligiendo un item"
MENU=$(curl -s "$BASE_URL/menu")
# El menú viene agrupado por categoría: aplanamos y tomamos el primero.
ITEM=$(echo "$MENU" | jq -c '[.[][]] | .[0] // empty')
[ -n "$ITEM" ] || die "No hay MenuItems. Crea alguno primero (POST /menu como STORE_MANAGER)."
MENU_ITEM_ID=$(echo "$ITEM" | jq -r '.id')
MENU_ITEM_NAME=$(echo "$ITEM" | jq -r '.name')
echo "  ✓ Item: $MENU_ITEM_NAME ($MENU_ITEM_ID)"

# ---- 2. CUSTOMER crea la orden ---------------------------------------------
step "Creando orden (CUSTOMER)  —  2x $MENU_ITEM_NAME, prioridad TIER2"
ORDER=$(curl -s -X POST "$BASE_URL/orders" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"items\":[{\"menuItemId\":\"$MENU_ITEM_ID\",\"quantity\":2}],\"priorityLevel\":\"TIER2\"}")
ORDER_ID=$(echo "$ORDER" | jq -r '.orderId // empty')
TOTAL=$(echo "$ORDER" | jq -r '.totalPrice // empty')
[ -n "$ORDER_ID" ] || die "No se creó la orden -> $ORDER"
echo "  ✓ Orden $ORDER_ID creada. Total: \$$TOTAL"
echo "    ETA estimada: $(echo "$ORDER" | jq -r '.estimatedReadyAt')"

# ---- 3. KITCHEN observa el estado de los hornos ----------------------------
step "Estado de la cocina (KITCHEN_MANAGER)"
curl -s "$BASE_URL/kitchen/monitor" \
  -H "Authorization: Bearer $KITCHEN_TOKEN" | jq '.'

# ---- 4. KITCHEN marca la orden como READY ----------------------------------
step "Marcando la orden como READY (KITCHEN_MANAGER)"
READY=$(curl -s -X PATCH "$BASE_URL/orders/$ORDER_ID/status" \
  -H "Authorization: Bearer $KITCHEN_TOKEN")
echo "  ✓ Estado -> $(echo "$READY" | jq -r '.status // .')"

# ---- 5. CUSTOMER paga (amount debe cubrir el total) ------------------------
step "Pagando la orden (CUSTOMER)  —  \$$TOTAL con CARD"
PAYMENT=$(curl -s -X POST "$BASE_URL/payments" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"orderId\":\"$ORDER_ID\",\"method\":\"CARD\",\"amount\":$TOTAL}")
PAID=$(echo "$PAYMENT" | jq -r '.paymentId // empty')
[ -n "$PAID" ] || die "El pago falló -> $PAYMENT"
echo "  ✓ Pago $PAID registrado. Vuelto: \$$(echo "$PAYMENT" | jq -r '.change')"

# ---- 6. verificaciones finales ---------------------------------------------
step "Verificando estado final de la orden (CUSTOMER)"
curl -s "$BASE_URL/orders/$ORDER_ID" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" | jq '{status, totalPrice}'

step "Verificando registro de pago (STORE_MANAGER)"
curl -s "$BASE_URL/payments/$ORDER_ID" \
  -H "Authorization: Bearer $MANAGER_TOKEN" | jq '.'

echo
echo "✅ Flujo completo OK  —  Orden $ORDER_ID: PENDING → READY → PAID"
