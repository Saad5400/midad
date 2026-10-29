@php
    $id           = $getId();
    $statePath    = $getStatePath();
    $height       = $getHeight() ?? 400;
    $iframeSrc    = $getSrc();
    $iframeOrigin = $getOrigin();
    $iframeData   = app(\Midad\Laravel\FrameContext::class)->resolve($getData());
    $resize       = $getResizeable();
    $locale       = $getLocale();
@endphp

<x-dynamic-component :component="$getFieldWrapperView()" :field="$field">
    <div
        wire:key="{{ $id }}"
            x-data="midadIframeField({
              id: @js($id),
              src: @js($iframeSrc),
              origin: @js($iframeOrigin),
              locale: @js($locale),
              data: @js($iframeData ?: (object)[]),
              height: @js($height . 'px'),
              state: $wire.{!! $applyStateBindingModifiers("\$entangle('{$getStatePath()}')") !!},
            })"
            x-init="init()"
        >
        <iframe
            x-ref="frame"
            src="{{ $iframeSrc }}"
            wire:ignore
            class="fi-fo-text-input fi-input-wrp"
            style="width:100%; height: {{ $height }}px; resize: {{ $resize }}"
            referrerpolicy="strict-origin-when-cross-origin">
        </iframe>
    </div>
</x-dynamic-component>

@once
<script>
    function midadIframeFormState(form) {
        if (!form) return null
        const groups = midadIframeFormState.groups ||= new WeakMap()
        if (groups.has(form)) return groups.get(form)
        let pending, scheduled = false
        const fields = new Set()
        const busy = () => [...fields].some(field => field.busy)
        const submit = event => {
            if (!busy()) return
            event.preventDefault()
            event.stopImmediatePropagation()
            pending = { submitter: event.submitter }
        }
        const group = {
            fields,
            flush() {
                if (!pending || busy() || scheduled) return
                scheduled = true
                queueMicrotask(() => {
                    scheduled = false
                    if (!pending || busy()) return
                    const { submitter } = pending
                    pending = undefined
                    if (form.isConnected) form.requestSubmit(submitter?.isConnected ? submitter : undefined)
                })
            },
            remove(field) {
                fields.delete(field)
                if (fields.size) this.flush()
                else {
                    pending = undefined
                    form.removeEventListener('submit', submit, true)
                    groups.delete(form)
                }
            },
        }
        form.addEventListener('submit', submit, true)
        groups.set(form, group)
        return group
    }

    function midadIframeField(opts) {
        const { id, origin, locale, data, height } = opts
        let frame, initialized = false, childState, cleanup = []
        const serialized = value => typeof value === 'string' ? value : JSON.stringify(value)
        function post(type, payload) {
            frame?.contentWindow?.postMessage({ type, payload }, origin)
        }
        function appearance() {
            try { return localStorage.getItem('theme') || null } catch { return null }
        }
        return {
            state: opts.state,
            init() {
                if (initialized) return
                initialized = true
                frame = this.$refs.frame
                const field = { busy: false }, form = midadIframeFormState(frame.closest('form'))
                form?.fields.add(field)
                const initialize = () => post('init', {
                    fieldId: id, state: Alpine.raw(this.state), data, height, locale, appearance: appearance(),
                })
                const message = event => {
                    if (event.origin !== origin || event.source !== frame.contentWindow) return
                    const msg = event.data || {}
                    if (msg.type === 'ready') initialize()
                    if (msg.type === 'editor:busy' && typeof msg.payload?.busy === 'boolean') {
                        field.busy = msg.payload.busy
                        form?.flush()
                    }
                    if (msg.type === 'state:updated' && msg.payload?.state !== undefined) {
                        childState = serialized(msg.payload.state)
                        this.state = msg.payload.state
                    }
                }
                const theme = event => {
                    const next = event.detail ?? appearance()
                    if (next) post('appearance:updated', { appearance: next })
                }
                window.addEventListener('message', message, { passive: true })
                window.addEventListener('theme-changed', theme)
                frame.addEventListener('load', initialize)
                const stop = this.$watch('state', value => {
                    if (childState !== undefined && serialized(value) === childState) {
                        childState = undefined
                        return
                    }
                    childState = undefined
                    post('state:updated', { state: value })
                })
                cleanup = [
                    () => form?.remove(field),
                    () => window.removeEventListener('message', message),
                    () => window.removeEventListener('theme-changed', theme),
                    () => frame.removeEventListener('load', initialize),
                    () => { if (typeof stop === 'function') stop() },
                ]
            },
            destroy() {
                for (const dispose of cleanup) dispose()
                cleanup = []
                initialized = false
            },
        }
    }
</script>
@endonce

