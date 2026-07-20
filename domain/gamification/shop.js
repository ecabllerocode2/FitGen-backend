export const SHOP_CATALOG = [
  {
    id: 'frame_neon',
    type: 'frame',
    name: 'Marco Neón',
    description: 'Marco neón para tarjetas compartibles.',
    price: 50,
    rarity: 'common',
    previewKey: 'frame_neon',
  },
  {
    id: 'frame_ember',
    type: 'frame',
    name: 'Marco Ember',
    description: 'Marco cálido para historias.',
    price: 75,
    rarity: 'rare',
    previewKey: 'frame_ember',
  },
  {
    id: 'celebration_power_aura',
    type: 'celebration',
    name: 'Aura de Poder',
    description: 'Animación especial al completar sesión.',
    price: 200,
    rarity: 'epic',
    previewKey: 'power_aura',
  },
  {
    id: 'share_template_neon_grid',
    type: 'shareTemplate',
    name: 'Plantilla Neón Grid',
    description: 'Fondo premium para tarjetas compartibles.',
    price: 50,
    rarity: 'common',
    previewKey: 'share_neon_grid',
  },
  {
    id: 'share_template_champion',
    type: 'shareTemplate',
    name: 'Plantilla Campeón',
    description: 'Diseño premium con tipografía exclusiva.',
    price: 80,
    rarity: 'rare',
    previewKey: 'share_champion',
  },
];

export const PREMIUM_REDEMPTION_COST = 500;
export const PREMIUM_REDEMPTION_DAYS = 30;
export const PREMIUM_REDEMPTION_MAX_PER_YEAR = 2;

export function getShopItem(itemId) {
  return SHOP_CATALOG.find((item) => item.id === itemId) ?? null;
}

export function listShopCatalog(inventory = {}) {
  const owned = new Set([
    ...(inventory.frames ?? []),
    ...(inventory.celebrations ?? []),
    ...(inventory.shareTemplates ?? []),
  ]);

  return SHOP_CATALOG.map((item) => ({
    ...item,
    owned: owned.has(item.id),
  }));
}

function inventoryKeyForType(type) {
  if (type === 'frame') return 'frames';
  if (type === 'celebration') return 'celebrations';
  if (type === 'shareTemplate') return 'shareTemplates';
  return null;
}

export function purchaseShopItem(gamification, itemId) {
  const item = getShopItem(itemId);
  if (!item) {
    throw Object.assign(new Error('Artículo no encontrado'), { status: 404 });
  }

  const key = inventoryKeyForType(item.type);
  if (!key) {
    throw Object.assign(new Error('Tipo de artículo inválido'), { status: 400 });
  }

  const next = {
    ...gamification,
    inventory: {
      frames: [...(gamification.inventory?.frames ?? [])],
      celebrations: [...(gamification.inventory?.celebrations ?? [])],
      shareTemplates: [...(gamification.inventory?.shareTemplates ?? ['default'])],
    },
  };

  if (next.inventory[key].includes(item.id)) {
    throw Object.assign(new Error('Ya tienes este artículo'), { status: 409 });
  }

  if ((next.fitCoinsBalance ?? 0) < item.price) {
    throw Object.assign(new Error('FitCoins insuficientes'), { status: 402 });
  }

  next.fitCoinsBalance -= item.price;
  next.inventory[key] = [...next.inventory[key], item.id];
  next.updatedAt = new Date().toISOString();

  return { gamification: next, item, fitCoinsSpent: item.price };
}

export function equipShopItem(gamification, itemId) {
  const item = getShopItem(itemId);
  if (!item) {
    throw Object.assign(new Error('Artículo no encontrado'), { status: 404 });
  }

  const key = inventoryKeyForType(item.type);
  if (!key || !gamification.inventory?.[key]?.includes(item.id)) {
    throw Object.assign(new Error('No posees este artículo'), { status: 403 });
  }

  const next = {
    ...gamification,
    avatar: { ...gamification.avatar },
    updatedAt: new Date().toISOString(),
  };

  if (item.type === 'frame') next.avatar.equippedFrameId = item.id;
  if (item.type === 'celebration') next.avatar.equippedCelebrationId = item.id;
  if (item.type === 'shareTemplate') next.avatar.equippedShareTemplateId = item.id;

  return { gamification: next, item };
}

export function redeemPremiumMonth(gamification, referenceDate = new Date()) {
  const year = referenceDate.getUTCFullYear();
  let redemptions = gamification.premiumRedemptionsThisYear ?? 0;
  if (gamification.premiumRedemptionYear !== year) {
    redemptions = 0;
  }

  if (redemptions >= PREMIUM_REDEMPTION_MAX_PER_YEAR) {
    throw Object.assign(new Error('Límite anual de canjes alcanzado'), { status: 429 });
  }

  if ((gamification.fitCoinsBalance ?? 0) < PREMIUM_REDEMPTION_COST) {
    throw Object.assign(new Error('FitCoins insuficientes para canje Premium'), { status: 402 });
  }

  const expiresAt = new Date(referenceDate);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + PREMIUM_REDEMPTION_DAYS);

  const next = {
    ...gamification,
    fitCoinsBalance: gamification.fitCoinsBalance - PREMIUM_REDEMPTION_COST,
    premiumRedemptionsThisYear: redemptions + 1,
    premiumRedemptionYear: year,
    updatedAt: referenceDate.toISOString(),
  };

  return {
    gamification: next,
    fitCoinsSpent: PREMIUM_REDEMPTION_COST,
    premiumExpiresAt: expiresAt.toISOString(),
  };
}
