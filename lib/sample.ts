export const SAMPLE_SOURCE = `def calculate_discount(price, discount):
    return price - price * discount

print(calculate_discount(100, 20))
`;

export const SAMPLE_BUG =
  "The function should interpret the discount as a percentage. With price=100 and discount=20, it should return 80, but it currently returns -1900.";
