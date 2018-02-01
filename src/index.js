import {
  toVNodes,
  camelize,
  hyphenate,
  callHooks,
  getInitialProps,
  createCustomEvent,
  convertAttributeValue
} from './utils.js'

export default function wrap (Vue, Component) {
  const options = typeof Component === 'function'
    ? Component.options
    : Component

  // inject hook to proxy $emit to native DOM events
  options.beforeCreate = [].concat(options.beforeCreate || [])
  options.beforeCreate.unshift(function () {
    const emit = this.$emit
    this.$emit = (name, ...args) => {
      this.$root.$options.customElement.dispatchEvent(createCustomEvent(name, args))
      return emit.call(this, name, ...args)
    }
  })

  // extract props info
  const propsList = Array.isArray(options.props)
    ? options.props
    : Object.keys(options.props || {})
  const hyphenatedPropsList = propsList.map(hyphenate)
  const camelizedPropsList = propsList.map(camelize)
  const originalPropsAsObject = Array.isArray(options.props) ? {} : options.props || {}
  const camelizedPropsMap = camelizedPropsList.reduce((map, key, i) => {
    map[key] = originalPropsAsObject[propsList[i]]
    return map
  }, {})

  class CustomElement extends HTMLElement {
    static get observedAttributes () {
      return hyphenatedPropsList
    }

    constructor () {
      super()
      const el = this
      this._wrapper = new Vue({
        name: 'shadow-root',
        customElement: this,
        data () {
          return {
            props: getInitialProps(camelizedPropsList),
            slotChildren: Object.freeze(toVNodes(
              this.$createElement,
              el.childNodes
            ))
          }
        },
        render (h) {
          return h(Component, {
            ref: 'inner',
            props: this.props
          }, this.slotChildren)
        }
      })

      // in Chrome, this.childNodes will be empty when connectedCallback
      // is fired, so it's necessary to use a mutationObserver
      const observer = new MutationObserver(() => {
        this._wrapper.slotChildren = Object.freeze(toVNodes(
          this._wrapper.$createElement,
          this.childNodes
        ))
      })
      observer.observe(this, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
      })
    }

    get vueComponent () {
      return this._wrapper.$refs.inner
    }

    connectedCallback () {
      if (!this._wrapper._isMounted) {
        this._shadowRoot = this.attachShadow({ mode: 'open' })
        this._wrapper.$options.shadowRoot = this._shadowRoot
        this._wrapper.$mount()
        // sync default props values to wrapper
        for (const key of camelizedPropsList) {
          this._wrapper.props[key] = this.vueComponent[key]
        }
        this._shadowRoot.appendChild(this._wrapper.$el)
      } else {
        callHooks(this.vueComponent, 'activated')
      }
    }

    disconnectedCallback () {
      callHooks(this.vueComponent, 'deactivated')
    }

    // watch attribute change and sync
    attributeChangedCallback (attrName, oldVal, newVal) {
      const camelized = camelize(attrName)
      this._wrapper.props[camelized] = convertAttributeValue(
        newVal,
        attrName,
        camelizedPropsMap[camelized]
      )
    }
  }

  // proxy props as Element properties
  camelizedPropsList.forEach(key => {
    Object.defineProperty(CustomElement.prototype, key, {
      get () {
        return this._wrapper.props[key]
      },
      set (newVal) {
        this._wrapper.props[key] = newVal
      },
      enumerable: false,
      configurable: true
    })
  })

  return CustomElement
}
