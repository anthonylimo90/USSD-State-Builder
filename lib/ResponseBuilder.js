/**
 * Response Builder Utilities for USSD State Machine
 * 
 * Provides convenient methods for building common USSD response patterns.
 * All responses follow the USSD convention of CON (continue) and END (terminate).
 */

const ResponseBuilder = {
    /**
     * Create a menu response with numbered options
     * @param {string} title - Menu title
     * @param {string[]} options - Array of menu options
     * @returns {string} Formatted CON response
     * 
     * @example
     * ResponseBuilder.menu('Select Service', ['Airtime', 'Data', 'Bills'])
     * // Returns: "CON Select Service\n1. Airtime\n2. Data\n3. Bills"
     */
    menu(title, options) {
        const optionsList = options
            .map((option, index) => `${index + 1}. ${option}`)
            .join('\n');
        return `CON ${title}\n${optionsList}`;
    },

    /**
     * Create a confirmation prompt
     * @param {string} message - Confirmation message
     * @param {string} [yesLabel='Yes'] - Label for yes option
     * @param {string} [noLabel='No'] - Label for no option
     * @returns {string} Formatted CON response
     * 
     * @example
     * ResponseBuilder.confirm('Confirm purchase of $10 airtime?')
     * // Returns: "CON Confirm purchase of $10 airtime?\n1. Yes\n2. No"
     */
    confirm(message, yesLabel = 'Yes', noLabel = 'No') {
        return `CON ${message}\n1. ${yesLabel}\n2. ${noLabel}`;
    },

    /**
     * Create an input prompt
     * @param {string} message - Prompt message
     * @returns {string} Formatted CON response
     * 
     * @example
     * ResponseBuilder.input('Enter your phone number:')
     * // Returns: "CON Enter your phone number:"
     */
    input(message) {
        return `CON ${message}`;
    },

    /**
     * Create an error message with retry option
     * @param {string} message - Error message
     * @param {string} [retryMessage='Please try again.'] - Retry instruction
     * @returns {string} Formatted CON response
     * 
     * @example
     * ResponseBuilder.error('Invalid input')
     * // Returns: "CON Invalid input\nPlease try again."
     */
    error(message, retryMessage = 'Please try again.') {
        return `CON ${message}\n${retryMessage}`;
    },

    /**
     * Create a success/end message
     * @param {string} message - Success message
     * @returns {string} Formatted END response
     * 
     * @example
     * ResponseBuilder.end('Thank you for using our service!')
     * // Returns: "END Thank you for using our service!"
     */
    end(message) {
        return `END ${message}`;
    },

    /**
     * Create a paginated list with navigation options
     * @param {string[]} items - Array of items to paginate
     * @param {number} page - Current page number (1-indexed)
     * @param {number} [pageSize=5] - Number of items per page
     * @param {Object} [options] - Pagination options
     * @param {string} [options.title] - List title
     * @param {string} [options.moreLabel='More'] - Label for next page option
     * @param {string} [options.backLabel='Back'] - Label for previous page option
     * @returns {string} Formatted CON response with pagination
     * 
     * @example
     * const items = ['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5', 'Item 6'];
     * ResponseBuilder.paginate(items, 1, 3, { title: 'Select Item' })
     * // Returns: "CON Select Item\n1. Item 1\n2. Item 2\n3. Item 3\n99. More"
     */
    paginate(items, page = 1, pageSize = 5, options = {}) {
        const { title = '', moreLabel = 'More', backLabel = 'Back' } = options;

        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const pageItems = items.slice(startIndex, endIndex);
        const totalPages = Math.ceil(items.length / pageSize);

        const itemsList = pageItems
            .map((item, index) => `${startIndex + index + 1}. ${item}`)
            .join('\n');

        let response = title ? `CON ${title}\n${itemsList}` : `CON ${itemsList}`;

        // Add navigation options
        const navOptions = [];
        if (page > 1) {
            navOptions.push(`98. ${backLabel}`);
        }
        if (page < totalPages) {
            navOptions.push(`99. ${moreLabel}`);
        }

        if (navOptions.length > 0) {
            response += '\n' + navOptions.join('\n');
        }

        return response;
    },

    /**
     * Add a back navigation option to a message
     * @param {string} message - Message to append back option to
     * @param {string} [backLabel='0. Back'] - Label for back option
     * @returns {string} Message with back option appended
     * 
     * @example
     * ResponseBuilder.withBack('CON Enter your name:')
     * // Returns: "CON Enter your name:\n0. Back"
     */
    withBack(message, backLabel = '0. Back') {
        return `${message}\n${backLabel}`;
    },

    /**
     * Create a message with multiple navigation options
     * @param {string} message - Base message
     * @param {Object} [navigation] - Navigation options
     * @param {boolean} [navigation.back=false] - Include back option
     * @param {boolean} [navigation.home=false] - Include home/main menu option
     * @param {boolean} [navigation.cancel=false] - Include cancel option
     * @returns {string} Message with navigation options
     * 
     * @example
     * ResponseBuilder.withNavigation('CON Enter amount:', { back: true, home: true })
     * // Returns: "CON Enter amount:\n0. Back\n00. Main Menu"
     */
    withNavigation(message, navigation = {}) {
        const { back = false, home = false, cancel = false } = navigation;
        const options = [];

        if (back) options.push('0. Back');
        if (home) options.push('00. Main Menu');
        if (cancel) options.push('*. Cancel');

        if (options.length > 0) {
            return `${message}\n${options.join('\n')}`;
        }
        return message;
    },

    /**
     * Format a monetary amount for display
     * @param {number} amount - Amount to format
     * @param {string} [currency='$'] - Currency symbol
     * @param {number} [decimals=2] - Number of decimal places
     * @returns {string} Formatted amount string
     * 
     * @example
     * ResponseBuilder.formatAmount(1234.5, 'KES ')
     * // Returns: "KES 1,234.50"
     */
    formatAmount(amount, currency = '$', decimals = 2) {
        const formatted = amount
            .toFixed(decimals)
            .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return `${currency}${formatted}`;
    },

    /**
     * Create a receipt/summary display
     * @param {string} title - Receipt title
     * @param {Object} items - Key-value pairs to display
     * @returns {string} Formatted END response with receipt
     * 
     * @example
     * ResponseBuilder.receipt('Transaction Complete', {
     *   'Amount': '$100.00',
     *   'Ref': 'TXN123456',
     *   'Date': '2024-01-15'
     * })
     */
    receipt(title, items) {
        const itemsList = Object.entries(items)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n');
        return `END ${title}\n${itemsList}`;
    },

    /**
     * Create a progress indicator message
     * @param {number} current - Current step
     * @param {number} total - Total steps
     * @param {string} message - Step message
     * @returns {string} Formatted CON response with progress
     * 
     * @example
     * ResponseBuilder.progress(2, 4, 'Enter your email:')
     * // Returns: "CON [Step 2/4]\nEnter your email:"
     */
    progress(current, total, message) {
        return `CON [Step ${current}/${total}]\n${message}`;
    },

    /**
     * Create a list without selection (informational)
     * @param {string} title - List title
     * @param {string[]} items - Array of items
     * @param {boolean} [isEnd=false] - Whether this ends the session
     * @returns {string} Formatted response
     * 
     * @example
     * ResponseBuilder.list('Your Orders:', ['Order #123', 'Order #456'], false)
     */
    list(title, items, isEnd = false) {
        const prefix = isEnd ? 'END' : 'CON';
        const itemsList = items.map(item => `- ${item}`).join('\n');
        return `${prefix} ${title}\n${itemsList}`;
    }
};

module.exports = ResponseBuilder;
