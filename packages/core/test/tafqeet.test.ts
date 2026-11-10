import { describe, it, expect } from 'vitest';
import { tafqeet, arabicInteger } from '../src/tafqeet.js';

describe('arabicInteger', () => {
  it('handles zero and small numbers', () => {
    expect(arabicInteger(0)).toBe('صفر');
    expect(arabicInteger(1)).toBe('واحد');
    expect(arabicInteger(11)).toBe('أحد عشر');
    expect(arabicInteger(21)).toBe('واحد وعشرون');
    expect(arabicInteger(100)).toBe('مئة');
    expect(arabicInteger(215)).toBe('مئتان وخمسة عشر');
  });

  it('handles thousands and millions with correct forms', () => {
    expect(arabicInteger(1000)).toBe('ألف');
    expect(arabicInteger(2000)).toBe('ألفان');
    expect(arabicInteger(3000)).toBe('ثلاثة آلاف');
    expect(arabicInteger(11000)).toBe('أحد عشر ألف');
    expect(arabicInteger(1_000_000)).toBe('مليون');
    expect(arabicInteger(2_500_000)).toBe('مليونان وخمسمئة ألف');
  });
});

describe('tafqeet', () => {
  it('renders pounds and piastres', () => {
    expect(tafqeet('1243.50')).toBe('فقط ألف ومئتان وثلاثة وأربعون جنيه مصري وخمسون قرش لا غير');
  });

  it('renders whole pounds only', () => {
    expect(tafqeet('500.00')).toBe('فقط خمسمئة جنيه مصري لا غير');
  });

  it('renders piastres only', () => {
    expect(tafqeet('0.75')).toBe('فقط خمسة وسبعون قرش لا غير');
  });

  it('renders zero', () => {
    expect(tafqeet('0')).toBe('فقط صفر جنيه مصري لا غير');
  });

  it('accepts numbers and rounds to piastres', () => {
    expect(tafqeet(100.994)).toBe('فقط مئة جنيه مصري وتسعة وتسعون قرش لا غير');
  });
});
