/**
 * DynamicMenuBuilder - Builder for dynamic/reactive USSD menus
 *
 * Enables fetching data from external sources at runtime, generating menu options
 * dynamically, handling user selection mapped back to original items, and pagination.
 */

/**
 * @typedef {Object} PaginationOptions
 * @property {number} [pageSize=5] - Items per page
 * @property {string} [moreKey='99'] - Key to show more items
 * @property {string} [backKey='98'] - Key to go to previous page
 * @property {string} [moreLabel='More'] - Label for more option
 * @property {string} [backLabel='Back'] - Label for back/previous option
 */

/**
 * @typedef {Object} DynamicMenuState
 * @property {Array} items - Fetched items
 * @property {number} page - Current page (0-indexed)
 * @property {boolean} fetched - Whether items have been fetched
 */

class DynamicMenuBuilder {
  constructor() {
    this._fetcher = null;
    this._formatter = (item, idx) => String(item);
    this._valueExtractor = (item) => item;
    this._header = '';
    this._pagination = null;
    this._emptyConfig = { message: 'No items available', action: 'end' };
    this._errorHandler = null;
    this._maxItems = null;
    this._refreshConfig = null;
  }

  /**
   * Set the data fetcher function
   * @param {(sessionId: string, context: object) => Promise<Array>} fn - Async function returning array of items
   * @returns {DynamicMenuBuilder} this for chaining
   */
  fetch(fn) {
    this._fetcher = fn;
    return this;
  }

  /**
   * Set the item formatter function
   * @param {(item: any, index: number) => string} fn - Function to format item for display
   * @returns {DynamicMenuBuilder} this for chaining
   */
  format(fn) {
    this._formatter = fn;
    return this;
  }

  /**
   * Set the value extractor function
   * @param {(item: any) => any} fn - Function to extract value from selected item
   * @returns {DynamicMenuBuilder} this for chaining
   */
  value(fn) {
    this._valueExtractor = fn;
    return this;
  }

  /**
   * Set the menu header text
   * @param {string} text - Header text displayed above menu items
   * @returns {DynamicMenuBuilder} this for chaining
   */
  header(text) {
    this._header = text;
    return this;
  }

  /**
   * Enable pagination with options
   * @param {PaginationOptions} options - Pagination configuration
   * @returns {DynamicMenuBuilder} this for chaining
   */
  paginated(options = {}) {
    this._pagination = {
      pageSize: options.pageSize || 5,
      moreKey: options.moreKey !== undefined ? String(options.moreKey) : '99',
      backKey: options.backKey !== undefined ? String(options.backKey) : '98',
      moreLabel: options.moreLabel || 'More',
      backLabel: options.backLabel || 'Back'
    };
    return this;
  }

  /**
   * Configure empty data handling
   * @param {string} message - Message to show when no items
   * @param {'end'|'continue'} [action='end'] - Whether to end or continue session
   * @returns {DynamicMenuBuilder} this for chaining
   */
  onEmpty(message, action = 'end') {
    this._emptyConfig = { message, action };
    return this;
  }

  /**
   * Set error handler for fetch failures
   * @param {(error: Error, sessionId: string, context: object) => string|object} handler
   * @returns {DynamicMenuBuilder} this for chaining
   */
  onError(handler) {
    this._errorHandler = handler;
    return this;
  }

  /**
   * Limit the maximum number of items stored in session to prevent memory issues
   * Items beyond this limit are truncated (not fetched items, but stored items)
   * @param {number} limit - Maximum items to store (recommended: 50-100 for USSD)
   * @returns {DynamicMenuBuilder} this for chaining
   */
  maxItems(limit) {
    this._maxItems = limit;
    return this;
  }

  /**
   * Enable data refresh capability
   * @param {Object} [options] - Refresh configuration
   * @param {string} [options.key='0'] - Key to trigger refresh
   * @param {string} [options.label='Refresh'] - Label for refresh option
   * @returns {DynamicMenuBuilder} this for chaining
   */
  refreshable(options = {}) {
    this._refreshConfig = {
      key: options.key !== undefined ? String(options.key) : '0',
      label: options.label || 'Refresh'
    };
    return this;
  }

  /**
   * Build and return the handler function compatible with StateBuilder.run()
   * @returns {(input: string, sessionId: string, context: object) => Promise<string|object>}
   */
  build() {
    const fetcher = this._fetcher;
    const formatter = this._formatter;
    const valueExtractor = this._valueExtractor;
    const header = this._header;
    const pagination = this._pagination;
    const emptyConfig = this._emptyConfig;
    const errorHandler = this._errorHandler;
    const maxItems = this._maxItems;
    const refreshConfig = this._refreshConfig;

    if (!fetcher) {
      throw new Error('DynamicMenuBuilder requires a fetcher function. Use .fetch() or DynamicMenu.from()');
    }

    // Validate pagination keys don't conflict with refresh key
    if (pagination && refreshConfig) {
      if (refreshConfig.key === pagination.moreKey || refreshConfig.key === pagination.backKey) {
        throw new Error(`Refresh key "${refreshConfig.key}" conflicts with pagination keys`);
      }
    }

    /**
     * Fetch and process items from the data source
     */
    async function fetchItems(sessionId, context) {
      let items = await fetcher(sessionId, context);
      items = Array.isArray(items) ? items : [];

      // Apply maxItems limit to prevent memory issues
      if (maxItems && items.length > maxItems) {
        items = items.slice(0, maxItems);
      }

      return items;
    }

    return async function dynamicMenuHandler(input, sessionId, context) {
      const sessionData = (context && context.sessionData) || {};
      let menuState = sessionData._dynamicMenu;

      // Handle refresh request
      if (refreshConfig && input === refreshConfig.key && menuState && menuState.fetched) {
        menuState = null; // Force re-fetch
      }

      // Initialize or fetch items on first call (empty input) or after refresh
      if (!menuState || !menuState.fetched) {
        try {
          const items = await fetchItems(sessionId, context);
          menuState = {
            items,
            page: 0,
            fetched: true
          };
        } catch (error) {
          if (errorHandler) {
            const result = errorHandler(error, sessionId, context);
            if (typeof result === 'string') {
              return { response: `END ${result}` };
            }
            return result;
          }
          // Default error handling
          return { response: 'END An error occurred. Please try again later.' };
        }
      }

      const { items } = menuState;
      let { page } = menuState;

      // Handle empty data
      if (items.length === 0) {
        const prefix = emptyConfig.action === 'end' ? 'END' : 'CON';
        return { response: `${prefix} ${emptyConfig.message}` };
      }

      // Calculate pagination values
      const pageSize = pagination ? pagination.pageSize : items.length;
      const totalPages = Math.ceil(items.length / pageSize);

      /**
       * Build the menu response for current page
       * @param {number} currentPage - Page number to render
       */
      function buildMenuResponse(currentPage) {
        const startIdx = currentPage * pageSize;
        const endIdx = Math.min(startIdx + pageSize, items.length);
        const pageItems = items.slice(startIdx, endIdx);
        const lines = [];

        if (header) {
          lines.push(header);
        }

        // Add numbered menu items
        pageItems.forEach((item, idx) => {
          const displayText = formatter(item, startIdx + idx);
          lines.push(`${idx + 1}. ${displayText}`);
        });

        // Add pagination controls
        if (pagination) {
          if (currentPage > 0) {
            lines.push(`${pagination.backKey}. ${pagination.backLabel}`);
          }
          if (currentPage < totalPages - 1) {
            lines.push(`${pagination.moreKey}. ${pagination.moreLabel}`);
          }
        }

        // Add refresh option
        if (refreshConfig) {
          lines.push(`${refreshConfig.key}. ${refreshConfig.label}`);
        }

        return {
          response: `CON ${lines.join('\n')}`,
          data: {
            ...sessionData,
            _dynamicMenu: { items, page: currentPage, fetched: true }
          }
        };
      }

      // Handle input (selection or pagination navigation)
      if (input) {
        // Check for pagination navigation
        if (pagination) {
          if (input === pagination.moreKey && page < totalPages - 1) {
            // Go to next page
            return buildMenuResponse(page + 1);
          }
          if (input === pagination.backKey && page > 0) {
            // Go to previous page
            return buildMenuResponse(page - 1);
          }
        }

        // Handle item selection
        const startIdx = page * pageSize;
        const endIdx = Math.min(startIdx + pageSize, items.length);
        const pageItems = items.slice(startIdx, endIdx);
        const selectionNum = parseInt(input, 10);
        if (!isNaN(selectionNum) && selectionNum >= 1 && selectionNum <= pageItems.length) {
          const selectedIdx = startIdx + selectionNum - 1;
          const selectedItem = items[selectedIdx];
          const selectedValue = valueExtractor(selectedItem);

          // Store selected value in session data for the compiler to use
          // The data will be merged by the compiler and _selectedItem will be used by save()
          const newSessionData = {
            ...sessionData,
            _selectedItem: selectedValue
          };
          // Clean up _dynamicMenu state
          delete newSessionData._dynamicMenu;

          return {
            response: null, // Let compiler resolve from next state
            data: newSessionData
          };
        }

        // Invalid input - show menu again
        return buildMenuResponse(page);
      }

      // No input - show menu
      return buildMenuResponse(page);
    };
  }
}

/**
 * Factory functions for DynamicMenuBuilder
 */
const DynamicMenu = {
  /**
   * Create a new DynamicMenuBuilder
   * @returns {DynamicMenuBuilder}
   */
  create() {
    return new DynamicMenuBuilder();
  },

  /**
   * Create a DynamicMenuBuilder with fetcher already set
   * @param {(sessionId: string, context: object) => Promise<Array>} fetcher
   * @returns {DynamicMenuBuilder}
   */
  from(fetcher) {
    return new DynamicMenuBuilder().fetch(fetcher);
  }
};

module.exports = { DynamicMenu, DynamicMenuBuilder };
