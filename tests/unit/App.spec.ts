import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from '@/entrypoints/popup/App.vue'

describe('popup App', () => {
  it('renders the component', () => {
    const wrapper = mount(App)
    expect(wrapper.find('div').exists()).toBe(true)
  })

  it('renders HelloWorld component', () => {
    const wrapper = mount(App)
    expect(wrapper.findComponent({ name: 'HelloWorld' }).exists()).toBe(true)
  })
})
