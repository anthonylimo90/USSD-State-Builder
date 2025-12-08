const ResponseBuilder = require('../lib/ResponseBuilder');

describe('ResponseBuilder', () => {
    describe('menu', () => {
        test('should create a numbered menu', () => {
            const result = ResponseBuilder.menu('Select Option', ['First', 'Second', 'Third']);
            expect(result).toBe('CON Select Option\n1. First\n2. Second\n3. Third');
        });

        test('should handle single option', () => {
            const result = ResponseBuilder.menu('Title', ['Only Option']);
            expect(result).toBe('CON Title\n1. Only Option');
        });
    });

    describe('confirm', () => {
        test('should create confirmation with default labels', () => {
            const result = ResponseBuilder.confirm('Are you sure?');
            expect(result).toBe('CON Are you sure?\n1. Yes\n2. No');
        });

        test('should create confirmation with custom labels', () => {
            const result = ResponseBuilder.confirm('Proceed?', 'Confirm', 'Cancel');
            expect(result).toBe('CON Proceed?\n1. Confirm\n2. Cancel');
        });
    });

    describe('input', () => {
        test('should create input prompt', () => {
            const result = ResponseBuilder.input('Enter your name:');
            expect(result).toBe('CON Enter your name:');
        });
    });

    describe('error', () => {
        test('should create error with default retry message', () => {
            const result = ResponseBuilder.error('Invalid input');
            expect(result).toBe('CON Invalid input\nPlease try again.');
        });

        test('should create error with custom retry message', () => {
            const result = ResponseBuilder.error('Wrong format', 'Enter again:');
            expect(result).toBe('CON Wrong format\nEnter again:');
        });
    });

    describe('end', () => {
        test('should create end message', () => {
            const result = ResponseBuilder.end('Goodbye!');
            expect(result).toBe('END Goodbye!');
        });
    });

    describe('paginate', () => {
        const items = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

        test('should show first page with More option', () => {
            const result = ResponseBuilder.paginate(items, 1, 3, { title: 'Items' });
            expect(result).toBe('CON Items\n1. A\n2. B\n3. C\n99. More');
        });

        test('should show middle page with Back and More options', () => {
            const result = ResponseBuilder.paginate(items, 2, 3, { title: 'Items' });
            expect(result).toBe('CON Items\n4. D\n5. E\n6. F\n98. Back\n99. More');
        });

        test('should show last page with only Back option', () => {
            const result = ResponseBuilder.paginate(items, 3, 3, { title: 'Items' });
            expect(result).toBe('CON Items\n7. G\n8. H\n98. Back');
        });

        test('should work without title', () => {
            const result = ResponseBuilder.paginate(['X', 'Y'], 1, 5);
            expect(result).toBe('CON 1. X\n2. Y');
        });
    });

    describe('withBack', () => {
        test('should append default back option', () => {
            const result = ResponseBuilder.withBack('CON Enter amount:');
            expect(result).toBe('CON Enter amount:\n0. Back');
        });

        test('should append custom back option', () => {
            const result = ResponseBuilder.withBack('CON Enter amount:', '00. Go Back');
            expect(result).toBe('CON Enter amount:\n00. Go Back');
        });
    });

    describe('withNavigation', () => {
        test('should add multiple navigation options', () => {
            const result = ResponseBuilder.withNavigation('CON Enter data:', {
                back: true,
                home: true,
                cancel: true
            });
            expect(result).toBe('CON Enter data:\n0. Back\n00. Main Menu\n*. Cancel');
        });

        test('should return message unchanged if no options', () => {
            const result = ResponseBuilder.withNavigation('CON Enter data:');
            expect(result).toBe('CON Enter data:');
        });
    });

    describe('formatAmount', () => {
        test('should format with default currency', () => {
            const result = ResponseBuilder.formatAmount(1234.56);
            expect(result).toBe('$1,234.56');
        });

        test('should format with custom currency', () => {
            const result = ResponseBuilder.formatAmount(1000, 'KES ');
            expect(result).toBe('KES 1,000.00');
        });

        test('should handle zero', () => {
            const result = ResponseBuilder.formatAmount(0, '€');
            expect(result).toBe('€0.00');
        });
    });

    describe('receipt', () => {
        test('should create formatted receipt', () => {
            const result = ResponseBuilder.receipt('Payment Complete', {
                'Amount': '$50.00',
                'Ref': 'ABC123'
            });
            expect(result).toBe('END Payment Complete\nAmount: $50.00\nRef: ABC123');
        });
    });

    describe('progress', () => {
        test('should show step progress', () => {
            const result = ResponseBuilder.progress(2, 5, 'Enter email:');
            expect(result).toBe('CON [Step 2/5]\nEnter email:');
        });
    });

    describe('list', () => {
        test('should create informational list', () => {
            const result = ResponseBuilder.list('Your Items:', ['Item 1', 'Item 2']);
            expect(result).toBe('CON Your Items:\n- Item 1\n- Item 2');
        });

        test('should create end list', () => {
            const result = ResponseBuilder.list('Summary:', ['Line 1', 'Line 2'], true);
            expect(result).toBe('END Summary:\n- Line 1\n- Line 2');
        });
    });
});
