import { createApp, defineComponent, h, shallowRef } from 'vue';
import { DocumentEditor } from '@saad5400/midad/vue';
import '@saad5400/midad/vue/style.css';

createApp(defineComponent({
    setup() {
        const editor = shallowRef();
        window.midadExample = { get editor() { return editor.value; } };
        const button = (label, action, api) => h('button', {
            type: 'button', disabled: !api.canSave(),
            onMousedown: (event) => event.preventDefault(), onClick: action,
        }, label);
        return () => h(DocumentEditor, {
            ref: editor, documentId: 'independent-vue-example', locale: 'en',
            content: { type: 'doc', content: [
                { type: 'heading', attrs: { id: 'title', level: 1, dir: 'ltr' }, content: [{ type: 'text', text: 'Your UI, Midad documents' }] },
                { type: 'paragraph', attrs: { id: 'english', dir: 'ltr' }, content: [{ type: 'text', text: 'Edit this document using your own toolbar and styles.' }] },
                { type: 'paragraph', attrs: { id: 'arabic', dir: 'rtl' }, content: [{ type: 'text', text: 'هذا المحرر يعمل باستقلال تام عن أي تطبيق آخر.' }] },
            ] },
        }, {
            'editor-toolbar': ({ editor: api }) => h('header', { 'data-custom-toolbar': '', class: 'native-format-toolbar' }, [
                h('strong', 'Application-owned toolbar'),
                button('Bold', () => api.format({ kind: 'toggle', mark: 'bold' }), api),
                button('Undo', () => api.undo(), api),
                button('Download PDF', () => api.download(), api),
            ]),
        });
    },
})).mount('#app');
