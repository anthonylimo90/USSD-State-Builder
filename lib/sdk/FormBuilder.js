/**
 * FormBuilder - Multi-step form/wizard builder for USSD applications
 *
 * Simplifies creating data-collection flows by auto-generating state chains
 * from field definitions.
 */
const StateBuilder = require('./StateBuilder');

/**
 * Builder for individual form fields
 */
class FieldBuilder {
  constructor(name) {
    this._name = name;
    this._prompt = null;
    this._validator = null;
    this._transform = null;
  }

  /**
   * Set the prompt message for this field
   * @param {string} text - Prompt text
   * @returns {FieldBuilder} this for chaining
   */
  prompt(text) {
    this._prompt = text;
    return this;
  }

  /**
   * Attach a validator function
   * @param {Function} fn - Validator function
   * @returns {FieldBuilder} this for chaining
   */
  validate(fn) {
    this._validator = fn;
    return this;
  }

  /**
   * Transform the input before saving
   * @param {Function} fn - Transform function (input) => transformedValue
   * @returns {FieldBuilder} this for chaining
   */
  transform(fn) {
    this._transform = fn;
    return this;
  }
}

/**
 * Builder for the confirmation step
 */
class ConfirmStepBuilder {
  constructor() {
    this._renderer = null;
    this._confirmInput = null;
    this._confirmAction = null;
    this._cancelInput = null;
    this._cancelAction = null;
  }

  /**
   * Set input that triggers confirmation
   * @param {string} input - Input value (e.g., '1')
   * @returns {ConfirmStepBuilder} this for chaining
   */
  onConfirm(input) {
    this._confirmInput = input;
    return this;
  }

  /**
   * Set input that triggers cancellation
   * @param {string} input - Input value (e.g., '2')
   * @returns {ConfirmStepBuilder} this for chaining
   */
  onCancel(input) {
    this._cancelInput = input;
    return this;
  }

  /**
   * End session with message on confirm
   * @param {string} message - End message
   * @returns {ConfirmStepBuilder} this for chaining
   */
  end(message) {
    if (this._confirmInput && !this._confirmAction) {
      this._confirmAction = { type: 'end', message };
    } else if (this._cancelInput && !this._cancelAction) {
      this._cancelAction = { type: 'end', message };
    }
    return this;
  }

  /**
   * Go to another state on confirm/cancel
   * @param {string} stateName - Target state
   * @returns {ConfirmStepBuilder} this for chaining
   */
  goto(stateName) {
    if (this._confirmInput && !this._confirmAction) {
      this._confirmAction = { type: 'goto', target: stateName };
    } else if (this._cancelInput && !this._cancelAction) {
      this._cancelAction = { type: 'goto', target: stateName };
    }
    return this;
  }
}

/**
 * Builder for multi-step forms/wizards
 */
class FormBuilder {
  constructor(name) {
    this._name = name;
    this._fields = [];
    this._confirmRenderer = null;
    this._confirmStep = null;
    this._onComplete = null;
  }

  /**
   * Add a field to the form
   * @param {string} name - Field name (used as session data key)
   * @param {(fieldBuilder: FieldBuilder) => void} configurator - Field configurator
   * @returns {FormBuilder} this for chaining
   */
  field(name, configurator) {
    const fieldBuilder = new FieldBuilder(name);
    configurator(fieldBuilder);

    if (!fieldBuilder._prompt) {
      throw new Error(`Field "${name}" must have a prompt`);
    }

    this._fields.push(fieldBuilder);
    return this;
  }

  /**
   * Add a confirmation step
   * @param {(context: object) => string} renderer - Function to render confirmation message
   * @returns {ConfirmStepBuilder} Builder for confirm/cancel actions
   */
  confirm(renderer) {
    this._confirmRenderer = renderer;
    this._confirmStep = new ConfirmStepBuilder();
    this._confirmStep._renderer = renderer;
    return this._confirmStep;
  }

  /**
   * Set the state to transition to after form completion (without confirm step)
   * @param {string} stateName - Target state name
   * @returns {FormBuilder} this for chaining
   */
  onComplete(stateName) {
    this._onComplete = stateName;
    return this;
  }

  /**
   * Compile the form into state builders
   * @returns {Array<[string, StateBuilder]>} Array of [stateName, StateBuilder] pairs
   */
  compile() {
    if (this._fields.length === 0) {
      throw new Error('Form must have at least one field');
    }

    const states = [];

    // Create state for each field
    for (let i = 0; i < this._fields.length; i++) {
      const field = this._fields[i];
      const stateName = `${this._name}_${field._name}`;
      const isLastField = i === this._fields.length - 1;

      // Determine next state
      let nextState;
      if (isLastField) {
        if (this._confirmRenderer) {
          nextState = `${this._name}_confirm`;
        } else if (this._onComplete) {
          nextState = this._onComplete;
        }
      } else {
        nextState = `${this._name}_${this._fields[i + 1]._name}`;
      }

      const stateBuilder = new StateBuilder(stateName);
      stateBuilder._message = field._prompt;

      if (field._validator) {
        stateBuilder._validator = field._validator;
      }

      // Handle save with optional transform
      if (field._transform) {
        stateBuilder._saveKey = (input, context) => {
          const sessionData = (context && context.sessionData) || {};
          return Object.assign({}, sessionData, { [field._name]: field._transform(input) });
        };
      } else {
        stateBuilder._saveKey = field._name;
      }

      if (nextState) {
        stateBuilder._nextState = nextState;
      } else {
        // No confirm and no onComplete - this is terminal
        stateBuilder._isEnd = true;
      }

      states.push([stateName, stateBuilder]);
    }

    // Create confirmation state if defined
    if (this._confirmRenderer && this._confirmStep) {
      const confirmStateName = `${this._name}_confirm`;
      const confirmBuilder = new StateBuilder(confirmStateName);

      // Use a custom handler to render the confirmation message
      const renderer = this._confirmRenderer;
      confirmBuilder._handler = async (input, sessionId, context) => {
        return renderer(context);
      };

      // Add routes for confirm/cancel
      const RouteBuilder = require('./RouteBuilder');

      if (this._confirmStep._confirmInput && this._confirmStep._confirmAction) {
        const route = new RouteBuilder(confirmBuilder, this._confirmStep._confirmInput);
        if (this._confirmStep._confirmAction.type === 'end') {
          route._isEnd = true;
          route._response = this._confirmStep._confirmAction.message;
        } else if (this._confirmStep._confirmAction.type === 'goto') {
          route._target = this._confirmStep._confirmAction.target;
        }
        confirmBuilder._routes.push(route);
      }

      if (this._confirmStep._cancelInput && this._confirmStep._cancelAction) {
        const route = new RouteBuilder(confirmBuilder, this._confirmStep._cancelInput);
        if (this._confirmStep._cancelAction.type === 'end') {
          route._isEnd = true;
          route._response = this._confirmStep._cancelAction.message;
        } else if (this._confirmStep._cancelAction.type === 'goto') {
          route._target = this._confirmStep._cancelAction.target;
        }
        confirmBuilder._routes.push(route);
      }

      states.push([confirmStateName, confirmBuilder]);
    }

    return states;
  }
}

module.exports = { FormBuilder, FieldBuilder, ConfirmStepBuilder };
