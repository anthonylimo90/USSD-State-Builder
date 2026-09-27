const CATALOG = Object.freeze({
  seeds: [
    { sku: 'MAIZE', name: 'Maize seed 2kg', price: 650, stock: 8 },
    { sku: 'BEANS', name: 'Bean seed 2kg', price: 520, stock: 6 }
  ],
  soil: [
    { sku: 'FERT', name: 'Fertilizer 5kg', price: 950, stock: 5 },
    { sku: 'COMPOST', name: 'Compost 10kg', price: 400, stock: 7 }
  ],
  tools: [
    { sku: 'GLOVES', name: 'Work gloves', price: 300, stock: 10 },
    { sku: 'TROWEL', name: 'Hand trowel', price: 450, stock: 4 }
  ]
});

const PRODUCTS = Object.fromEntries(
  Object.values(CATALOG).flat().map(product => [product.sku, product])
);

module.exports = { CATALOG, PRODUCTS };
