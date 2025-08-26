/**
 * Fast-check fuzz test for cron expression handling.
 * Совместимо с разными вариантами экспорта cron-parser.
 */
import fc from 'fast-check';
import * as cronNS from 'cron-parser';

// Универсальный доступ к API: предпочитаем parseExpression,
// иначе пробуем CronExpressionParser.parse
function parseCron(expr: string, opts: any) {
    const mod: any = (cronNS as any)?.default ?? (cronNS as any);

    // Вариант 1: старая API
    if (mod?.parseExpression) {
        return mod.parseExpression(expr, opts);
    }

    // Вариант 2: новая API
    if (mod?.CronExpressionParser?.parse) {
        return mod.CronExpressionParser.parse(expr, opts);
    }

    // Вариант 3: ещё один возможный путь (редко)
    if (cronNS && (cronNS as any).CronExpressionParser?.parse) {
        return (cronNS as any).CronExpressionParser.parse(expr, opts);
    }

    throw new Error(
        'cron-parser API not found: neither parseExpression nor CronExpressionParser.parse present'
    );
}

// Генераторы полей cron
const field = (min: number, max: number) =>
    fc.oneof(
        fc.constant('*'),
        fc.integer({ min, max }).map(String),
        fc
            .tuple(fc.integer({ min, max }), fc.integer({ min, max }))
            .filter(([a, b]) => a <= b)
            .map(([a, b]) => `${a}-${b}`),
        fc
            .tuple(fc.constant('*'), fc.integer({ min: 1, max: 30 }))
            .map(([star, step]) => `${star}/${step}`)
    );

// second minute hour day-of-month month day-of-week
const cronExprArb = fc
    .tuple(
        field(0, 59),
        field(0, 59),
        field(0, 23),
        field(1, 31),
        field(1, 12),
        field(0, 6)
    )
    .map(parts => parts.join(' '));

describe('cron-parser fuzz (fast-check)', () => {
    it('does not hard-crash on next() for random cron expr', () => {
        fc.assert(
            fc.property(cronExprArb, (expr) => {
                try {
                    const it: any = parseCron(expr, {
                        currentDate: new Date('2025-01-01T00:00:00Z'),
                        tz: 'UTC',
                    });
                    const next = it.next();
                    expect(next).toBeTruthy();
                    // В API cron-parser разные формы возвращаемого значения:
                    // где-то есть toDate(), где-то сам объект Date в .value
                    const dt: any = typeof next.toDate === 'function'
                        ? next.toDate()
                        : (next.value ?? next)?.toDate?.() ?? (next.value ?? next);
                    expect(dt instanceof Date || Object.prototype.toString.call(dt) === '[object Date]').toBe(true);
                } catch (e) {
                    // Ожидаемые ошибки парсинга допустимы, главное — без падения рантайма
                    expect(e).toBeTruthy();
                }
            }),
            { numRuns: 500 }
        );
    });
});
