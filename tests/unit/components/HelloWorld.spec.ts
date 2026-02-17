import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import HelloWorld from '@/components/HelloWorld.vue'

describe('helloWorld', () => {
  it('renders props.msg when passed', () => {
    const msg = 'new message'
    const wrapper = mount(HelloWorld, {
      props: { msg },
    })
    expect(wrapper.text()).toContain(msg)
  })

  it('increments count when button is clicked', async () => {
    const wrapper = mount(HelloWorld, {
      props: { msg: 'Test' },
    })

    const button = wrapper.find('button')
    expect(button.text()).toContain('count is 0')

    await button.trigger('click')
    expect(button.text()).toContain('count is 1')

    await button.trigger('click')
    expect(button.text()).toContain('count is 2')
  })
})
