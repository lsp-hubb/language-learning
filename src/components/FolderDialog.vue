<script setup>
import { ref, nextTick, watch } from 'vue'
import { useFileExplorerStore } from '@/stores/fileExplorer'

const store = useFileExplorerStore()

const showDialog = ref(false)
const dialogMode = ref('create') // 'create' | 'rename'
const dialogFolderId = ref(null)
const dialogName = ref('')
const nameInput = ref(null)

watch(showDialog, (val) => {
  if (val) {
    nextTick(() => {
      nameInput.value?.focus()
    })
  }
})

function open(mode, folderId = null, currentName = '') {
  dialogMode.value = mode
  dialogFolderId.value = folderId
  dialogName.value = currentName
  showDialog.value = true
}

async function confirmDialog() {
  const name = dialogName.value.trim()
  if (!name) return

  let ok = false
  if (dialogMode.value === 'create') {
    ok = await store.createFolder(name)
  } else if (dialogMode.value === 'rename' && dialogFolderId.value) {
    await store.renameFolder(dialogFolderId.value, name)
    ok = true
  }

  if (!ok) {
    alert('创建失败，请检查后端服务是否已启动（需先运行 start.bat）')
    return
  }
  showDialog.value = false
}

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <div v-if="showDialog" class="dialog-overlay" @click.self="showDialog = false">
      <div class="dialog" @click.stop>
        <div class="dialog-title">
          {{ dialogMode === 'create' ? '新建文件夹' : '重命名' }}
        </div>
        <input
          ref="nameInput"
          v-model="dialogName"
          class="dialog-input"
          type="text"
          placeholder="请输入文件夹名称"
          @keyup.enter="confirmDialog"
          @keyup.esc="showDialog = false"
        />
        <div class="dialog-actions">
          <button class="btn btn-cancel" @click="showDialog = false">取消</button>
          <button
            class="btn btn-primary"
            :disabled="!dialogName.trim()"
            @click="confirmDialog"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  width: 360px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
}
.dialog-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
}
.dialog-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.dialog-input:focus {
  border-color: #4a90d9;
  box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.15);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.btn {
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.btn-primary {
  background: #4a90d9;
  color: #fff;
}
.btn-primary:hover {
  background: #357abd;
}
.btn-primary:disabled {
  background: #a0c4e8;
  cursor: not-allowed;
}
.btn-cancel {
  background: #e8e8e8;
  color: #333;
}
.btn-cancel:hover {
  background: #d4d4d4;
}
</style>
