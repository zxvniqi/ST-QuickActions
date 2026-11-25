// 편의성 모음 (Quick Actions) for SillyTavern
import { MODULE, getSettings, paintPalette } from './settings.js';
import { initDeleteButton, applyDeleteButtonSetting } from './delete-button.js';
import { initChatPicker } from './chat-picker.js';
import { initNameOverride, applyNameSettings } from './name-override.js';
import { initSelectionTools } from './selection-tools.js';
import { initLayoutManager, applyLayoutSettings } from './layout-manager.js';
import { openLayoutEditor } from './layout-editor.js';
import { createInlineSelect } from './inline-select.js';
import { FOOTER_POSITIONS, initMessageTools, applyMessageToolSettings } from './message-tools.js';
import { FLOATING_LAYOUTS, orderedFloatingButtons, initFloatingPanel, applyFloatingSettings, pickMenuItems } from './floating-panel.js';
import { QR_MODES, initQrBar, applyQrPreset } from './qr-bar.js';
import { initQrInput, refreshQrMessage } from './qr-input.js';
import { initStatusGuard } from './status-guard.js';
import { initDisplayTweaks, applyDisplayTweaks } from './display-tweaks.js';
import { FOLDER_AREAS, initFolders, applyFolders } from './folders.js';
import { initPresetFolders, applyFolderButtons } from './preset-folders.js';
import { initToggleSets, applyToggleSets } from './prompt-toggle-sets.js';
import { initRangeDelete, applyRangeDelete } from './range-delete.js';
import { initSaveGuard } from './save-guard.js';
import { initErrorLog } from './error-log.js';
import { initVertexProfileFix } from './vertex-profile-fix.js';
import { initCharListTools, applyCharListTools } from './char-list-tools.js';
import { initChatExport, applyChatExport } from './chat-export.js';
import { initChatName, applyChatName } from './chat-name.js';
import { initChatReplace, applyChatReplace } from './chat-replace.js';
import { initChatSearch, applyChatSearch } from './chat-search.js';
import { initChatSort, applyChatSort } from './chat-sort.js';
import { initMessageTrash, applyMessageTrash, purge as purgeTrash } from './message-trash.js';
import { initSwipeList, applySwipeList } from './swipe-list.js';
import { initBackupView, applyBackupView } from './backup-view.js';
import { initKoFill, applyKoFill } from './ko-fill.js';
import { MAX_RETRIES, EMPTY_REPLY_MODES, emptyReplyMode, initEmptyReply } from './empty-reply.js';
import { initPromptCopy, applyPromptCopy } from './prompt-copy.js';
import { initPromptRenderFix } from './prompt-render-fix.js';
import { DEFAULT_TRANSLATE_PROMPT, initEntryTranslate, applyEntryTranslate } from './entry-translate.js';
import { initExtensionLinks, applyExtensionLinks, pickExtensionLinks } from './extension-links.js';
import { initWorldPicker, applyWorldPicker } from './world-pick.js';
import { initPersonaTools, applyPersonaTools } from './persona-tools.js';

const TOOLBAR_POSITIONS = [
    { value: 'dock', label: '버튼 위치: 화면 아래' },
    { value: 'above', label: '버튼 위치: 선택한 글자 위' },
    { value: 'below', label: '버튼 위치: 선택한 글자 아래' },
];
// Shortcut chips: hold this long to pick one up; a finger moving more before that is scrolling
const CHIP_HOLD_MS = 400;
const CHIP_TOLERANCE = 8;


/** Every feature: setting key → [name, description]. The description's first sentence shows
 * under the name; all of it is the feature's help. */
const FEATURES = Object.freeze({
    deleteButton: ['삭제 버튼 꺼내 두기', '편집(연필)을 눌러야 보이는 휴지통 버튼을 연필 옆에 꺼내 둡니다.\n· 지우는 방식은 ST와 같습니다.\n· 스와이프가 여러 개인 마지막 답변은 그 스와이프만 지울지 묻습니다(ST 삭제 확인이 켜져 있을 때).'],
    menuToBottom: ['메시지 끝으로 가기', '메시지 추가 메뉴(연필과 같은 곳)에 ↓ 버튼이 생깁니다. 누르면 그 메시지의 마지막 줄로 갑니다.'],
    footerSwipe: ['답변 넘기기 버튼', '마지막 답변 아래에 ‹ 1/3 › 이 생깁니다.\n· ‹ 는 이전 답변, › 는 다음 답변입니다.\n· 마지막 답변에서 › 를 누르면 새로 생성합니다.\n· 켜 두면 ST 스와이프 화살표는 숨깁니다.\n· 위치는 아래에서 고릅니다.'],
    swipeList: ['스와이프 목록', '스와이프 번호(2/3)를 누르면 그 메시지의 스와이프가 카드로 뜹니다.\n· 카드에는 번호, 글자 수, 앞부분이 보이고, 보고 있는 것은 "지금"으로 표시됩니다.\n· 카드를 누르면 그 스와이프로 바뀌고, 오른쪽 위 버튼으로 전체를 봅니다.\n· 번역해서 보는 메시지면 카드에 번역문이 보이고, 크게 보기에서 원문과 번역문을 바꿔 봅니다.\n· "여러 개 고르기"로 한 번에 지울 수 있습니다(하나는 남습니다).\n· 휴지통이 켜져 있으면 지운 스와이프도 휴지통으로 갑니다.'],
    footerTop: ['메시지 처음으로 가기', '메시지 아래에 ↑ 버튼이 생깁니다. 누르면 그 메시지의 첫 줄로 갑니다. 위치는 아래에서 고릅니다.'],
    selectionTools: ['드래그해서 수정·삭제', '글자를 드래그해 고르면 "수정"·"삭제" 버튼이 뜹니다.\n· 수정은 고른 부분만 고치는 창을 엽니다. 번역된 메시지면 번역문을 고치고, 원문도 고치려면 창의 "원문 전환"을 누릅니다. 자동으로 찾은 원문 부분이 맞는지 보고 고치세요.\n· 삭제는 고른 부분만 지웁니다. 번역된 메시지면 확인 창에서 번역문·원문 중 지울 쪽을 고릅니다. 뜨는 알림을 누르면 되돌립니다.\n· 버튼 위치는 아래에서 고릅니다.'],
    emptyReplyDelete: ['빈 답변 자동 삭제·재생성', '오류 등으로 답변이 아무것도 없이 오면 알림을 띄우고 아래에서 고른 대로 합니다. QR이 만든 답변에도 적용됩니다.\n· 지우기만: 그 메시지(스와이프면 그 스와이프만)를 지웁니다.\n· 다시 생성만: 빈 메시지는 두고 새로 생성합니다(일반 답변은 새 스와이프로).\n· 지우고 다시 생성: 지운 뒤 새로 생성합니다.\n· 다시 생성은 정한 횟수(최대 10번)만큼 하고, 그래도 비어 있으면 멈추고 알려 줍니다.\n· 글자, 추론, 사진·파일이 하나도 없을 때만 빈 답변으로 봅니다. 직접 멈춘 생성은 건드리지 않습니다.'],
    keepStatusPanels: ['정규식 렌더링 픽스', '정규식이 만든 HTML 화면(상태창 등)이 번역이나 다시 불러오기 뒤에 코드로 보이면 다시 그립니다.\n· 주점 도우미(Tavern Helper)가 그리는 화면에 적용됩니다.\n· 번역문은 그대로 둡니다.\n· 그래도 안 되면 메시지 다시 그리기 버튼(⟳)으로 그 메시지를 다시 그립니다.'],
    redrawButton: ['메시지 다시 그리기 버튼', '메시지 메뉴(연필과 같은 곳)에 ⟳ 버튼이 생깁니다. 누르면 그 메시지를 다시 그립니다(정규식 화면, 상태창 등).\n· 메시지 글은 바꾸지 않습니다.\n· 답변 생성 중에는 쓸 수 없습니다.'],
    chatPicker: ['캐릭터 누르면 채팅 목록부터', '캐릭터 목록이나 즐겨찾기 줄에서 캐릭터를 누르면, 마지막 채팅 대신 채팅 목록부터 보여 줍니다.\n· 목록에서 채팅을 고르거나 이름 바꾸기·내보내기·삭제를 할 수 있습니다.\n· 위쪽 아이콘으로 채팅 전체를 zip으로 내보내거나 불러옵니다.\n· 채팅 하나 불러오기(ST의 채팅 가져오기)와 백업 보기도 위쪽 아이콘에 있습니다.\n· 해골 아이콘으로 캐릭터를 삭제합니다. 지금 열린 채팅은 닫힙니다.'],
    chatExportAll: ['채팅 전체 내보내기·불러오기', '채팅 목록 창(Chat History)의 "채팅 가져오기" 옆에 아이콘 두 개가 생깁니다.\n· zip 아이콘: 그 캐릭터의 채팅 전부를 zip 하나로 받습니다.\n· 폴더 아이콘: zip이나 .jsonl 여러 개를 원래 이름 그대로 불러옵니다.\n· 이름이 겹치면 뒤에 (2)를 붙이고, 원래 채팅은 건드리지 않습니다.'],
    chatSort: ['채팅 목록 정렬', 'ST 채팅 목록 창(Chat History)의 검색칸 옆과 편의성 모음 채팅 목록에 정렬 버튼이 생깁니다. 누르면 최근 대화순(ST 기본), 최신순, 오래된 순 중에서 고릅니다.\n· 최신순·오래된 순은 채팅을 만든 날짜로 정렬합니다. 날짜는 채팅 이름에서 읽고, 이름에 날짜가 없는 채팅만 처음 한 번 파일에서 읽어 이 기기에 기억해 둡니다(그 처음 한 번은 채팅이 많으면 조금 걸립니다).\n· 두 목록이 같은 정렬을 씁니다.'],
    chatQuickRename: ['채팅 이름을 페르소나·캐릭터 이름으로', '채팅 목록 창의 연필 옆에 사람 모양 버튼이 생깁니다.\n· 누르면 그 채팅 이름을 페르소나 이름, 페르소나 + 날짜, 캐릭터 이름, 캐릭터 + 날짜 중 골라 바로 바꿉니다.\n· 페르소나는 그 채팅에 고정한 것(없으면 지금 것)이고, 날짜는 채팅을 만든 날입니다.'],
    rangeDelete: ['메시지 범위 삭제', '옵션 메뉴(입력창 왼쪽 ☰)에 "메시지 범위 삭제"가 생깁니다.\n· 첫 메시지와 끝 메시지를 누르면 그 사이만 체크됩니다(ST 기본은 끝까지).\n· 입력창 자리의 삭제 버튼으로 지우고, 취소로 나옵니다.'],
    rangeHide: ['메시지 범위 숨기기', '옵션 메뉴에 "메시지 범위 숨기기"가 생깁니다.\n· 범위 삭제처럼 첫·끝 메시지를 눌러 고른 뒤 숨깁니다.\n· 숨긴 메시지는 채팅에 남지만 AI에게 보내지 않고, 눈 버튼으로 다시 보이게 합니다.\n· 바로가기 버튼에서는 번호를 적어서 숨깁니다.'],
    messageTrash: ['메시지 휴지통', '지운 메시지를 휴지통에 보관합니다. 옵션 메뉴 "휴지통"에서 되살리거나 완전히 지웁니다.\n· 지운 메시지와 스와이프 하나만 지운 것도 담깁니다. 같은 메시지 것은 한 묶음입니다.\n· 메시지는 원래 자리로 돌아갑니다. 스와이프는 그 메시지의 스와이프 맨 뒤에 붙고, 그 메시지가 없으면 원래 자리에 새로 생깁니다.\n· 보관 기간이 지난 것은 ST를 켤 때 정리합니다.\n· 최대 개수를 정하면 채팅마다 넘는 것을 오래된 것부터 지웁니다.\n· 채팅을 지우면 그 휴지통도 지워집니다.\n· 서버에 따로 저장하므로 그만큼 공간을 씁니다. ST 백업과는 별개입니다.'],
    backupView: ['채팅 백업 캐릭터별로 보기·불러오기', '채팅 목록 창의 "Backups"를 누르면 백업이 창으로 뜹니다.\n· 지금 캐릭터(그룹) 백업만 최신순으로 보이고, "전체"로 모든 캐릭터 것을 봅니다.\n· 파일 이름 대신 저장 시각과 메시지 수가 보입니다.\n· 보기는 채팅처럼 보여 주고, 긴 메시지는 눌러서 펼칩니다.\n· 불러오기는 새 채팅으로 들어오고, 지금 채팅은 그대로 둡니다.'],
    chatReplace: ['채팅 단어 한꺼번에 바꾸기', '옵션 메뉴에 "채팅 단어 바꾸기"가 생깁니다. 지금 채팅의 모든 메시지에서 단어를 한꺼번에 바꿉니다(예: 상태창 2024 → 2205).\n· 찾은 개수를 누르면 바뀔 곳이 모두 펼쳐지고, 체크를 풀면 그곳은 바꾸지 않습니다.\n· 바꾼 뒤에도 새로고침 전까지는 알림이나 창의 되돌리기 버튼으로 되돌립니다.\n· 스와이프와 번역문도 같이 바꿉니다.\n· 단어 단위로만: 더 긴 단어나 숫자의 일부는 바꾸지 않습니다(20을 찾으면 2025는 그대로, 20년·(20)은 바뀜).\n· 범위: 메시지 번호로 바꿀 곳을 정합니다. 비워 두면 처음·끝까지입니다.\n· 답변 생성 중에는 쓸 수 없습니다.'],
    chatSearch: ['채팅에서 찾기', '옵션 메뉴에 "채팅에서 찾기"가 생깁니다. 위에 검색칸, 입력창 자리에 ▲ ▼ ✕ 가 뜹니다.\n· 가장 최근에 나온 곳으로 가서 형광펜을 칠하고, 지금 위치는 진한 주황색입니다.\n· ▲ 는 위쪽(더 옛날), ▼ 는 아래쪽 결과로 갑니다.\n· 아래 칸에 "몇 번째 메시지 · 그 안에서 몇 번째"가 보입니다.\n· 안 불러온 옛 메시지도 찾아서 불러옵니다.\n· 폰은 엔터를 누르면 검색만 하고, 컴퓨터는 엔터마다 다음 결과로 갑니다.'],
    welcomeRecent: ['시작 화면에 최근 채팅 펼치기', '채팅을 열기 전 시작 화면에서 어시스턴트 메시지, 로고·버전, 링크·임시 채팅 버튼을 숨기고 최근 채팅을 모두 펼칩니다.'],
    charListTools: ['목록에서 바로 즐겨찾기·태그', '캐릭터 목록의 캐릭터마다 ☆와 태그 버튼이 생깁니다. 캐릭터를 열지 않고 즐겨찾기와 태그를 바꿀 수 있습니다.'],
    personaTools: ['페르소나 메모·연결 캐릭터·폴더', '페르소나 목록에서 원하는 페르소나를 찾기 쉽게 합니다.\n· 메모: 페르소나 이름 아래 칸에 적으면 목록에 설명 대신 보이고, 검색으로도 찾습니다.\n· 연결 캐릭터: 페르소나에 연결된 캐릭터와, 그 페르소나로 고정한 채팅의 캐릭터가 이름 옆에 작은 프로필 사진으로 보입니다.\n· 폴더: 목록 위 버튼으로 폴더를 만들고 페르소나를 넣습니다. 폴더를 누르면 그 폴더의 페르소나만 보입니다.\n· 채팅 중이면 그 캐릭터에 연결된 페르소나(채팅 고정 포함)만 보는 칩이 생깁니다.\n· 채팅 고정은 일주일에 한 번 모든 채팅을 읽어 알아 둡니다. 연 채팅은 바로 반영합니다.'],
    hdAvatars: ['프로필 사진 고화질', '채팅과 캐릭터 목록의 프로필 사진을 썸네일 대신 원본으로 보여 줍니다.\n· 목록 사진은 화면에 보일 때, 원본을 다 받은 뒤에 바꿉니다.\n· 큰 사진이 많아 느리면 이것부터 꺼 보세요.'],
    qrBar: ['QR바 정리', '입력창 위 QR 버튼을 세트별로 한 줄씩 두고, 줄마다 옆으로 밀어서 넘깁니다.\n· 여는 방법은 아래에서 고릅니다: ▲▼ 버튼(마법봉 옆), 얇은 바(입력창 바로 위), 세트 이름.'],
    qrHistory: ['QR 입력창 도구', 'QR 입력창의 버튼 줄 왼쪽에 지우기·복사, 오른쪽에 최근 입력 버튼이 생깁니다.\n· 최근 입력은 마지막 3개이고, 어느 QR에서 입력했든 함께 나옵니다.'],
    qrSwipe: ['QR 답변도 스와이프로 다시 만들기', 'QR이 만든 메시지(/gen → /sendas 등)의 마지막 스와이프에서 오른쪽으로 넘기면 같은 입력값으로 그 QR을 다시 실행합니다.\n· 결과는 새 스와이프로 들어갑니다.\n· 켠 뒤에 QR로 만든 메시지부터 적용됩니다.'],
    hideInputPlaceholder: ['입력창 안내 문구 숨기기', '입력창에 흐리게 보이는 "Type a message…" 문구를 숨깁니다.'],
    floatingPanel: ['바로가기 버튼', '자주 쓰는 버튼(최근 메시지 삭제, 맨 위·아래, 한 메시지 위·아래, 번호로 이동, 범위 숨기기, 이름 바꾸기)을 한곳에 모아 둡니다.\n· 최근 메시지 삭제는 마지막 답변에 스와이프가 여러 개면 그 스와이프만 지울지 고릅니다.\n· 한 메시지 위·아래는 화면 맨 위 메시지를 기준으로 하나씩 움직이고, 꾹 누르고 있으면 그 방향으로 천천히 스크롤됩니다.\n· 보이는 방식은 입력창 위에 펼치기(··· 로 열고 닫기), 늘 보이기, 떠 있는 버튼(··· 를 꾹 눌러 끌어 옮김) 중에서 고릅니다.\n· 칩을 눌러 보일 버튼을 고르고, 꾹 눌러 끌면 순서가 바뀝니다.\n· "메뉴 항목 추가"로 마법봉·옵션 메뉴·입력창 버튼과 확장 설정도 넣을 수 있습니다. 확장 설정은 누르면 그 설정만 창으로 뜹니다.'],
    rangeStepButtons: ['삭제·숨기기 중 이동 버튼', '메시지를 지우거나 숨길 범위를 고르는 동안 입력창 위 양옆에 이동 버튼이 뜹니다.\n· 한 메시지씩 위·아래로, 또는 맨 위·맨 아래로 갑니다.\n· 바로가기 버튼을 꺼도 쓸 수 있습니다.'],
    presetFolders: ['프롬프트 폴더·관리', '프롬프트 선택 칸을 누르면 폴더로 정리된 목록이 열립니다. 맨 위 찾기 칸에 이름을 적으면 폴더 안의 것까지 찾습니다.\n· 펼친 폴더는 목록을 닫으면 다시 접힙니다. 새로 추가한 프롬프트는 맨 위에 보입니다.\n· 목록 맨 위 "프롬프트 관리"에서 순서를 바꾸고(≡ 를 끌거나, ≡ 를 누른 뒤 넣을 자리를 누름), 폴더를 만들거나 옮기고, 여러 개를 한꺼번에 지웁니다.'],
    promptImport: ['다른 프롬프트에서 가져오기', '목록 아래 ✚ 옆 버튼으로 다른 프롬프트의 항목을 골라 지금 프롬프트에 복사합니다.\n· "넣을 위치"를 누르고 지금 목록의 항목을 고르면 그 바로 아래에 들어갑니다(기본은 맨 아래, 맨 위도 고를 수 있습니다).\n· 복사본은 가져온 쪽의 켜짐·꺼짐을 그대로 가집니다.\n· 가져온 항목에는 잠깐 "가져옴" 표시가 붙습니다.'],
    promptReplace: ['다른 프롬프트 항목으로 교체', '항목의 ··· 메뉴에 "다른 프롬프트 항목으로 교체"가 생깁니다.\n· 다른 프롬프트의 항목을 하나 고르면 그 이름·내용·역할·넣는 위치 설정을 가져옵니다.\n· 지금 항목의 목록 순서와 켜짐·꺼짐은 그대로입니다.\n· 교체 직후 뜨는 알림을 누르면 되돌립니다.'],
    promptTapMove: ['☰ 눌러서 옮기기', '항목 왼쪽 ☰ 를 누른 뒤 넣을 자리의 항목을 누르면 그 자리로 옮깁니다. 끌지 않아도 됩니다.\n· ☰ 를 다시 누르거나 목록 밖을 누르면 취소됩니다.'],
    toggleSetChips: ['빠른 전환 (항목 켜기·끄기 저장)', '프롬프트 항목 목록 위에 빠른 전환 버튼 줄이 생깁니다.\n· "+ 빠른 전환 추가"로 지금 프롬프트에서 어떤 항목을 켜 두었는지 이름 붙여 저장합니다(내용·순서는 저장하지 않습니다).\n· 저장한 버튼을 누르면 그 켜짐·꺼짐 조합을 다시 적용합니다.\n· 버튼의 연결 아이콘을 누르면 지금 채팅과 연결됩니다. 다음에 그 채팅을 열면 그 프롬프트와 조합이 함께 적용되고 알림이 뜹니다(채팅마다 하나).\n· ✎ 로 덮어쓰기·이름 바꾸기·지우기를 하고, 프롬프트마다 따로 저장됩니다.'],
    promptCopy: ['프롬프트 항목 메뉴 (···)', '프롬프트 항목 목록의 연필 옆에 ··· 버튼이 생깁니다. 누르면 복사, 맨 위로, 맨 아래로, 삭제가 뜹니다.\n· 복사: 사본이 바로 아래에 꺼진 채로 들어가고, 이름 뒤에 "(복사)"가 붙습니다. 마커 항목(채팅 기록, 캐릭터 설명 등)은 복사할 수 없습니다.\n· 삭제: 목록에서 빼는 것(연결 끊기)이 아니라 항목을 아예 지웁니다. 지우기 전에 묻고, 되돌릴 수 없습니다. ST 기본 항목은 지울 수 없습니다.'],
    layoutManager: ['메뉴 정리', '확장 메뉴, 옵션 메뉴, 상단 바, 입력창 버튼, 메시지 메뉴, 확장 설정의 항목을 숨기거나 순서를 바꿉니다. 끄면 원래대로 돌아갑니다.\n· 순서는 ≡ 를 끌어서 바꾸거나, ≡ 를 눌러 고른 뒤 넣을 자리의 항목을 누릅니다.'],
    wandGrid: ['확장 메뉴를 아이콘으로', '확장 메뉴(마법봉)를 아이콘만, 한 줄에 2개씩 보여 줍니다.\n· 꾹 누르면 이름이 잠깐 뜨고(그때는 실행되지 않습니다), 컴퓨터는 마우스를 올리면 보입니다.'],
    optionsGrid: ['옵션 메뉴를 아이콘으로', '옵션 메뉴(☰)를 아이콘만, 한 줄에 2개씩 보여 줍니다.\n· 꾹 누르면 이름이 잠깐 뜨고(그때는 실행되지 않습니다), 컴퓨터는 마우스를 올리면 보입니다.'],
    extensionLinks: ['확장 설정 바로가기', '확장 설정(태번 헬퍼, 정규식 등)을 옵션 메뉴·마법봉·메시지 메뉴에 넣습니다. 누르면 그 확장 설정만 창으로 뜹니다.\n· 아래 "항목 고르기"에서 확장마다 넣을 곳을 고릅니다.\n· 이름 앞 아이콘을 누르면 아이콘을 바꿉니다. "기본"은 확장 자체 아이콘(없으면 이름 첫 글자)입니다.\n· 탭이 있는 확장은 처음 열릴 탭을 정할 수 있습니다. 창으로 열 때도, 확장 패널에서 직접 펼칠 때도 그 탭이 뜹니다.\n· 메뉴 정리에서 숨긴 확장도 넣을 수 있습니다.\n· 바로가기 버튼에는 바로가기 탭의 "메뉴 항목 추가"에서 넣습니다. 아이콘은 여기서 고른 것을 씁니다.'],
    regexFolders: ['정규식 폴더', '정규식 목록을 폴더로 묶어 접고 펼칩니다. 폴더는 정규식 창의 "폴더" 버튼에서 만듭니다.\n· 폴더에 넣은 정규식은 목록에서 한데 모이고, 실행 순서도 그 목록 순서를 따릅니다. 떨어져 있던 정규식을 한 폴더에 넣으면 순서가 바뀔 수 있습니다.'],
    koFill: ['ST 한국어 번역 채우기·고치기', 'ST를 한국어로 쓸 때 영어로 남은 버튼·메뉴·설정·알림을 한국어로 채우고, 뜻이 틀린 번역도 고쳐서 보여 줍니다(예: "스포일러 무료 모드" → "스포일러 방지 모드").\n· 샘플러 용어나 서비스·모델 이름처럼 영어가 나은 것은 그대로 둡니다.\n· 끄면 새로고침한 뒤 원래대로 돌아갑니다.'],
    hideSettingHints: ['ST 설정 설명 글씨 숨기기', 'ST 설정 항목 아래의 흐린 설명 글씨를 모두 숨깁니다.'],
    errorLog: ['오류 알림 자세히 보기', '빨간 오류 알림에 돋보기 버튼이 생깁니다. 누르면 그 알림에 관한 오류가 창으로 뜨고 복사할 수 있습니다.\n· 이전 오류는 아래에 접혀 있습니다. 접힌 채로 복사하면 지금 오류만, 펼치면 모두 복사합니다.\n· 서버가 돌려준 오류(API 오류 문구 등), 화면 스크립트 오류, 오류 알림을 최근 30개까지 모읍니다.\n· 서버 플러그인(선택, 확장 폴더의 server-plugin)을 깔면 "서버 화면"에서 최근 서버 기록도 함께 봅니다.\n· 새로고침하면 사라집니다.'],
    vertexProfileFix: ['연결 프로필 버텍스(서비스 계정) 오류 픽스', '확장이 연결 프로필로 요청할 때(번역, 요약 등) 버텍스 AI 서비스 계정에서 나는 오류를 고칩니다.\n· 빠진 로그인 방식을 지금 버텍스 설정(서비스 계정, 프로젝트·지역)으로 채워 보냅니다.\n· 연결 프로필을 쓰는 다른 확장에도 적용됩니다.'],
    worldPicker: ['월드인포 목록 창', '월드인포 편집 창의 선택 칸을 누르면 긴 목록 대신 창이 뜹니다.\n· 이름으로 찾고, ★ 를 누른 것은 즐겨찾기 탭에 모입니다.\n· 이름 아래에 그 월드인포가 연결된 캐릭터가 작은 프로필 사진으로 보이고, 누르면 그 캐릭터로 갑니다.\n· 채팅에 연결한 월드인포는 말풍선 표시가 붙고, 누르면 그 채팅으로 갑니다(이 기능을 켠 뒤 열어 본 채팅만 표시합니다).\n· 찾기 칸 옆 정렬 버튼으로 기본 순, 최근 본 순 중에서 고릅니다.'],
    entryTranslate: ['프롬프트·월드인포·설명 번역해서 보기', '프롬프트, 월드인포, 캐릭터 설명을 한국어로 번역해서 봅니다. 번역문은 읽기용이라 답변을 만들 때는 원문을 씁니다.\n· 목록 전체: 프롬프트 목록(✚ 옆 文A)과 월드인포(페이지 넘김 옆 文A, 월드인포를 고른 뒤 보임)에서 번역하고 지웁니다.\n· 하나씩: 편집 창·항목·캐릭터 설명의 文A로 번역하고, ⇄ 로 원문과 번역을 바꿔 보고, 지우개로 지웁니다. 프롬프트 편집 창과 월드인포 항목은 文A·지우개를 누르면 이름만, 내용만, 전체 중에서 고릅니다.\n· 번역 중엔 버튼이 돌고, 다시 누르면 멈춥니다. 여러 곳을 동시에 번역할 수 있습니다.\n· 번역문을 보는 중에 크게 보기(⤢)를 누르면 번역문이 크게 보입니다.\n· 번역문을 보는 동안은 고칠 수 없으니, ⇄ 로 원문으로 돌린 뒤 고치세요.\n· 번역문은 이 브라우저에 저장합니다. 번역할 때는 그 글을 고른 번역 서비스(구글 또는 AI)로 보냅니다.\n· 다른 방식으로 다시 하려면 지우개로 먼저 지우세요.\n· 방식은 아래에서 고릅니다: 구글(기본) 또는 AI(API와 번역 프롬프트를 따로 지정).'],
});

/**
 * The settings window: categories, groups of rows in them, and rows. A row is one feature (its
 * key), or features of one kind put together: { id, name, icon, summary, parts: [[key, chip, icon]] },
 * each part with its own chip (switch) and help. Extra controls (selects, buttons) go under the
 * feature they belong to, by key.
 */
const CATEGORIES = Object.freeze([
    { title: '메시지', icon: 'fa-message', groups: [
        ['버튼', [
            { id: 'messageMenu', name: '메시지 메뉴 버튼', icon: 'fa-ellipsis', summary: '연필 옆과 메시지 메뉴에 버튼을 꺼내 둡니다.', parts: [['deleteButton', '삭제', 'fa-trash-can'], ['menuToBottom', '끝으로', 'fa-arrow-down'], ['redrawButton', '다시 그리기', 'fa-arrows-rotate']] },
            { id: 'messageFooter', name: '메시지 아래 버튼', icon: 'fa-grip-lines', summary: '메시지 아래에 답변 넘기기와 처음으로 버튼이 생깁니다.', parts: [['footerSwipe', '답변 넘기기', 'fa-left-right'], ['footerTop', '처음으로', 'fa-arrow-up']] },
        ]],
        ['편집', ['selectionTools', 'swipeList']],
        ['자동', ['emptyReplyDelete', 'keepStatusPanels']],
    ] },
    { title: '채팅', icon: 'fa-comments', groups: [
        ['☰ 옵션 메뉴', [
            { id: 'optionMenu', name: '옵션 메뉴 항목', icon: 'fa-bars', summary: '옵션 메뉴(☰)에 채팅 도구를 넣습니다.', parts: [['rangeDelete', '범위 삭제', 'fa-eraser'], ['rangeHide', '범위 숨기기', 'fa-eye-slash'], ['chatReplace', '단어 바꾸기', 'fa-right-left'], ['chatSearch', '찾기', 'fa-magnifying-glass']] },
            'messageTrash',
        ]],
        ['채팅 목록 창', [
            { id: 'chatHistory', name: '채팅 목록 창 버튼', icon: 'fa-clock-rotate-left', summary: '채팅 목록 창(Chat History)에 버튼이 생깁니다.', parts: [['chatExportAll', '전체 내보내기·불러오기', 'fa-file-zipper'], ['chatSort', '정렬', 'fa-arrow-down-wide-short'], ['chatQuickRename', '이름 바꾸기', 'fa-user-pen'], ['backupView', '백업 보기', 'fa-box-archive']] },
        ]],
        ['채팅 열기', ['chatPicker', 'welcomeRecent']],
    ] },
    { title: '캐릭터', icon: 'fa-user', groups: [
        ['목록', ['charListTools', 'hdAvatars']],
        ['페르소나', ['personaTools']],
    ] },
    { title: '입력창·QR', icon: 'fa-keyboard', groups: [
        ['QR', ['qrBar', 'qrHistory', 'qrSwipe']],
        ['입력창', ['hideInputPlaceholder']],
    ] },
    { title: '바로가기', icon: 'fa-bolt', groups: [
        ['', ['floatingPanel', 'rangeStepButtons']],
    ] },
    { title: '프롬프트', icon: 'fa-file-lines', groups: [
        ['', ['presetFolders', { id: 'promptList', name: '프롬프트 항목 목록 버튼', icon: 'fa-list-check', summary: '프롬프트 항목 목록에 버튼이 생깁니다.', parts: [['toggleSetChips', '빠른 전환', 'fa-toggle-on'], ['promptCopy', '··· 메뉴', 'fa-ellipsis'], ['promptImport', '가져오기', 'fa-file-import'], ['promptReplace', '교체', 'fa-right-left'], ['promptTapMove', '☰ 옮기기', 'fa-hand-pointer']] }]],
    ] },
    { title: '메뉴 정리', icon: 'fa-table-columns', groups: [
        ['정리', ['layoutManager', { id: 'menuGrids', name: '메뉴를 아이콘으로', icon: 'fa-table-cells', summary: '메뉴를 아이콘만, 한 줄에 2개씩 보여 줍니다.', parts: [['wandGrid', '확장 메뉴(마법봉)', 'fa-wand-magic-sparkles'], ['optionsGrid', '옵션 메뉴(☰)', 'fa-bars']] }]],
        ['넣기', ['extensionLinks', 'regexFolders']],
    ] },
    { title: '화면·기타', icon: 'fa-display', groups: [
        ['번역', ['koFill', 'entryTranslate']],
        ['화면', ['hideSettingHints', 'worldPicker']],
        ['오류', [{ id: 'errors', name: '오류 도구', icon: 'fa-triangle-exclamation', summary: '오류를 자세히 보고, 버텍스 프로필 오류를 고칩니다.', parts: [['errorLog', '오류 알림 자세히', 'fa-magnifying-glass'], ['vertexProfileFix', '버텍스 프로필 픽스', 'fa-cloud']] }]],
    ] },
]);

/** The settings window's colours (style.css draws each by its id); dots: how the choice looks. */
const PALETTES = Object.freeze([
    { id: 'forest', name: '숲', dots: ['#2c6a4d', '#f1f2ec'] },
    { id: 'ocean', name: '바다', dots: ['#2a5d8f', '#eef2f6'] },
    { id: 'rose', name: '장미', dots: ['#a2445a', '#f6efef'] },
    { id: 'lavender', name: '라벤더', dots: ['#6a4fa3', '#f1f0f6'] },
    { id: 'night', name: '밤', dots: ['#2a2f35', '#7cc4a0'] },
    { id: 'theme', name: '테마', dots: ['var(--SmartThemeQuoteColor)', 'var(--SmartThemeBlurTintColor)'] },
]);

/** The first page: rows starred (☆ on each row), in the order they were starred. */
const FAVORITES_TITLE = '즐겨찾기';

/** Icons of rows that are one feature. */
const ICONS = Object.freeze({
    selectionTools: 'fa-i-cursor', swipeList: 'fa-layer-group', emptyReplyDelete: 'fa-rotate', keepStatusPanels: 'fa-wand-magic-sparkles',
    messageTrash: 'fa-trash-arrow-up', chatPicker: 'fa-list', welcomeRecent: 'fa-house', charListTools: 'fa-star', hdAvatars: 'fa-image',
    personaTools: 'fa-id-card', qrBar: 'fa-keyboard', qrHistory: 'fa-clock', qrSwipe: 'fa-repeat', hideInputPlaceholder: 'fa-eye-slash',
    floatingPanel: 'fa-bolt', rangeStepButtons: 'fa-arrows-up-down', presetFolders: 'fa-folder', layoutManager: 'fa-sliders', extensionLinks: 'fa-link', regexFolders: 'fa-folder-tree',
    koFill: 'fa-language', entryTranslate: 'fa-language', hideSettingHints: 'fa-text-slash', worldPicker: 'fa-book-atlas',
});

/** More words a feature is found by. */
const TERMS = Object.freeze({
    messageTrash: '복원 복구 되살리기', swipeList: '답변 후보 이전 답변', qrBar: '퀵리플라이 접기', layoutManager: '메뉴 배치 순서 숨기기',
    chatSearch: '검색 대화', entryTranslate: '로어북', personaTools: '고정', floatingPanel: '위로 아래로 맨위 맨아래 이동', footerSwipe: '스와이프 화살표',
});

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

/** Re-applies every feature (after one or the whole extension was switched). */
const APPLIERS = [
    applyDeleteButtonSetting, applyMessageToolSettings, refreshQrMessage, applyFloatingSettings, applyQrPreset,
    applyDisplayTweaks, applyLayoutSettings, () => Object.keys(FOLDER_AREAS).forEach(applyFolders), applyFolderButtons,
    applyToggleSets, applyPromptCopy, applyRangeDelete, applyNameSettings, applyCharListTools, applyChatExport,
    applyChatName, applyChatReplace, applyChatSearch, applyChatSort, applyMessageTrash, applySwipeList,
    applyBackupView, applyEntryTranslate, applyExtensionLinks, applyWorldPicker, applyPersonaTools, applyKoFill,
];

/** Every feature made to follow its setting (one failing doesn't stop the others). */
function applyAll() {
    for (const apply of APPLIERS) {
        try {
            apply();
        } catch (error) {
            console.error(`[${MODULE}] Applying settings failed`, error);
        }
    }
}

/** Where each feature shows up (or 자동: it works by itself). */
const WHERE = Object.freeze({
    deleteButton: '메시지 연필 옆',
    menuToBottom: '메시지 메뉴',
    footerSwipe: '마지막 답변 아래',
    swipeList: '스와이프 번호',
    footerTop: '메시지 아래',
    selectionTools: '글자 드래그',
    emptyReplyDelete: '자동',
    keepStatusPanels: '자동',
    redrawButton: '메시지 메뉴',
    chatPicker: '캐릭터 목록',
    chatExportAll: '채팅 목록 창',
    chatSort: '채팅 목록 창',
    chatQuickRename: '채팅 목록 창',
    rangeDelete: '☰ 옵션 메뉴',
    rangeHide: '☰ 옵션 메뉴',
    messageTrash: '☰ 옵션 메뉴',
    backupView: '채팅 목록 창 › Backups',
    chatReplace: '☰ 옵션 메뉴',
    chatSearch: '☰ 옵션 메뉴',
    welcomeRecent: '시작 화면',
    charListTools: '캐릭터 목록',
    personaTools: '페르소나 관리 창',
    worldPicker: '월드인포 선택 칸',
    hdAvatars: '자동',
    qrBar: '입력창 위',
    qrHistory: 'QR 입력창',
    qrSwipe: 'QR 메시지 스와이프',
    hideInputPlaceholder: '입력창',
    presetFolders: '프롬프트 선택 칸',
    toggleSetChips: '프롬프트 목록 위',
    promptCopy: '프롬프트 항목 ···',
    promptImport: '프롬프트 목록 ✚ 옆',
    promptReplace: '프롬프트 항목 ···',
    rangeStepButtons: '삭제 모드',
    promptTapMove: '프롬프트 항목 ☰',
    entryTranslate: '프롬프트·월드인포 文A',
    layoutManager: '메뉴 정리 창',
    extensionLinks: '☰ · 마법봉 · 메시지 메뉴',
    wandGrid: '마법봉',
    optionsGrid: '☰ 옵션 메뉴',
    regexFolders: '정규식 창 › 폴더',
    koFill: '자동',
    hideSettingHints: '자동',
    errorLog: '빨간 오류 알림',
    vertexProfileFix: '자동',
});

/** A description's first sentence (shown under the name). */
function firstSentence(text) {
    const firstLine = text.split('\n')[0];
    const end = firstLine.search(/다\.(\s|$)/);
    return end === -1 ? firstLine : firstLine.slice(0, end + 2);
}

// Text a feature is found by (its name, description, place and tab), without spaces
const searchable = text => text.toLowerCase().replace(/\s+/g, '');

/** A description as the help shows it: its sentences, then its "· " points as a list. */
function helpText(description) {
    const box = document.createDocumentFragment();
    const lines = description.split('\n').map(line => line.trim()).filter(Boolean);
    for (const line of lines.filter(line => !line.startsWith('·'))) {
        const paragraph = document.createElement('p');
        paragraph.textContent = line;
        box.append(paragraph);
    }
    const points = lines.filter(line => line.startsWith('·'));
    if (points.length) {
        const list = document.createElement('ul');
        for (const point of points) {
            const item = document.createElement('li');
            item.textContent = point.slice(1).trim();
            list.append(item);
        }
        box.append(list);
    }
    return box;
}

function whereLine(key) {
    const line = document.createElement('div');
    line.className = 'stqa_set_where';
    line.innerHTML = '<i class="fa-solid fa-location-dot"></i><span></span>';
    line.querySelector('span').textContent = WHERE[key] ?? '';
    line.hidden = !WHERE[key];
    return line;
}

/** A row's place: its features' places, each said once. */
function placeOf(keys) {
    return [...new Set(keys.flatMap(key => (WHERE[key] ?? '').split(/\s*[,·]\s*/)).filter(Boolean))].join(' · ');
}

/**
 * One row of the settings window: a feature with its switch, or features of one kind (parts)
 * with a chip each. Its settings show under it while it is on; its help folds under 도움말.
 */
function featureRow(item, category) {
    const settings = getSettings();
    const single = typeof item === 'string';
    const keys = single ? [item] : item.parts.map(([key]) => key);
    const name = single ? FEATURES[item][0] : item.name;
    const row = document.createElement('div');
    row.className = 'stqa_set_row';
    row.dataset.category = category;
    row.dataset.id = single ? item : item.id;
    row.innerHTML = `
        <div class="stqa_set_main">
            <span class="stqa_set_icon"><i class="fa-solid"></i></span>
            <div class="stqa_set_text">
                <div class="stqa_set_name"><b></b><b class="stqa_set_name_end"><b></b><span class="stqa_set_fav" role="button" tabindex="0" title="즐겨찾기"><i class="fa-regular fa-star"></i></span></b><span class="stqa_set_cat" hidden></span></div>
                <div class="stqa_set_sum stqa_set_helpbtn" role="button" tabindex="0" aria-expanded="false" title="도움말"><span></span><span class="stqa_set_name_end"><span></span><span class="stqa_set_chev"></span></span></div>
            </div>
        </div>
        <div class="stqa_set_opts"></div>
        <div class="stqa_set_help" hidden></div>`;
    // ☆ right after the name; the line under it opens the help (⌄ at its end)
    row.querySelector('.stqa_set_icon i').classList.add(single ? ICONS[item] ?? 'fa-circle' : item.icon);
    // (The last word and ☆ never part at a line's end; b, not span: some themes thin every span)
    const words = name.split(' ');
    const last = words.pop();
    row.querySelector('.stqa_set_name > b').textContent = words.length ? `${words.join(' ')} ` : '';
    row.querySelector('.stqa_set_name_end > b').textContent = last;
    // (Its ⌄ stays with the last word too)
    const sumWords = (single ? firstSentence(FEATURES[item][1]) : item.summary).split(' ');
    const sumLast = sumWords.pop();
    row.querySelector('.stqa_set_sum > span').textContent = sumWords.length ? `${sumWords.join(' ')} ` : '';
    row.querySelector('.stqa_set_sum .stqa_set_name_end > span').textContent = sumLast;
    const place = placeOf(keys);
    if (single) {
        const toggle = document.createElement('label');
        toggle.className = 'stqa_set_switch';
        toggle.innerHTML = `<input type="checkbox" data-setting="${item}">`;
        toggle.querySelector('input').checked = settings[item] !== false;
        toggle.title = name;
        row.querySelector('.stqa_set_main').append(toggle);
    } else {
        const chips = document.createElement('div');
        chips.className = 'stqa_set_chips';
        for (const [key, label, icon] of item.parts) {
            const chip = document.createElement('label');
            chip.className = 'stqa_set_chip';
            chip.dataset.key = key;
            chip.innerHTML = `<input type="checkbox" data-setting="${key}"><i class="fa-solid ${icon}"></i><span></span>`;
            chip.querySelector('span').textContent = label;
            chip.querySelector('input').checked = settings[key] !== false;
            chips.append(chip);
        }
        row.querySelector('.stqa_set_main').after(chips);
    }
    // Each feature's own settings, shown while it is on (features of a row: under their name)
    const options = row.querySelector('.stqa_set_opts');
    for (const key of keys) {
        const extra = extrasFor(key);
        if (!extra.childNodes.length) {
            continue;
        }
        const box = document.createElement('div');
        box.className = 'stqa_set_opt';
        box.dataset.for = key;
        if (!single) {
            // Its name and its settings on one line
            const [, label] = item.parts.find(([part]) => part === key);
            const title = document.createElement('span');
            title.className = 'stqa_set_opt_title';
            title.textContent = label;
            box.classList.add('stqa_set_opt_part');
            box.append(title);
        }
        box.append(extra);
        options.append(box);
    }
    // Help: the descriptions as they are, with where each shows up (a row of several: each
    // under its own name)
    const help = row.querySelector('.stqa_set_help');
    if (single) {
        help.append(helpText(FEATURES[item][1]), whereLine(item));
    } else {
        for (const [key, label, icon] of item.parts) {
            const part = document.createElement('div');
            part.className = 'stqa_set_part';
            part.dataset.key = key;
            const title = document.createElement('div');
            title.className = 'stqa_set_part_title';
            title.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
            title.querySelector('span').textContent = label;
            part.append(title, helpText(FEATURES[key][1]), whereLine(key));
            help.append(part);
        }
    }
    const helpButton = row.querySelector('.stqa_set_helpbtn');
    const toggleHelp = () => {
        help.hidden = !help.hidden;
        helpButton.setAttribute('aria-expanded', String(!help.hidden));
        delete row.dataset.autoHelp;
    };
    helpButton.addEventListener('click', toggleHelp);
    helpButton.addEventListener('keydown', event => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), toggleHelp()));
    row.dataset.search = searchable([name, row.querySelector('.stqa_set_sum').textContent, place, category,
        ...(single ? [] : item.parts.map(([, label]) => label)),
        ...keys.flatMap(key => [FEATURES[key][0], FEATURES[key][1], WHERE[key] ?? '', TERMS[key] ?? ''])].join(' '));
    row.stqaKeys = keys;
    // Each chip's own words, so a search can point at the chip it found
    row.stqaPartSearch = single ? null : Object.fromEntries(item.parts.map(([key, label]) => [key,
        searchable([label, FEATURES[key][0], FEATURES[key][1], WHERE[key] ?? '', TERMS[key] ?? ''].join(' '))]));
    row.stqaOwnSearch = searchable([name, row.querySelector('.stqa_set_sum').textContent].join(' '));
    syncRow(row);
    return row;
}

/** A row dims when all its features are off; a feature's settings show only while it is on. */
function syncRow(row) {
    const settings = getSettings();
    row.classList.toggle('stqa_set_off', row.stqaKeys.every(key => settings[key] === false));
    row.querySelectorAll('.stqa_set_opt').forEach(box => (box.hidden = settings[box.dataset.for] === false));
    row.querySelector('.stqa_set_opts').hidden = ![...row.querySelectorAll('.stqa_set_opt')].some(box => !box.hidden);
}

function panelButton(icon, text, onClick) {
    const button = document.createElement('div');
    button.className = 'menu_button stqa_panel_button';
    button.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
    button.querySelector('span').textContent = text;
    button.addEventListener('click', onClick);
    return button;
}

/** Long-press a chip, then drag it among the others to move it; a short tap still ticks it. */
function enableChipOrdering(chips, onReorder) {
    // The tap that ends a drag must not tick the chip it lands on
    let quietUntil = 0;
    chips.addEventListener('click', (event) => {
        if (Date.now() < quietUntil) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);
    chips.addEventListener('contextmenu', event => event.preventDefault());
    chips.addEventListener('pointerdown', (event) => {
        const chip = event.target.closest('.stqa_chip');
        if (!chip) {
            return;
        }
        const start = { x: event.clientX, y: event.clientY };
        let dragging = false;
        const timer = setTimeout(() => {
            dragging = true;
            chip.classList.add('stqa_dragging');
            navigator.vibrate?.(15);
        }, CHIP_HOLD_MS);
        const onMove = (moveEvent) => {
            if (!dragging) {
                // Moving before the hold is a scroll
                if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) > CHIP_TOLERANCE) {
                    end();
                }
                return;
            }
            const other = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('.stqa_chip');
            if (other && other !== chip && other.parentElement === chips) {
                const box = other.getBoundingClientRect();
                moveEvent.clientX > box.left + box.width / 2 ? other.after(chip) : other.before(chip);
            }
        };
        // While dragging the window must not scroll under the finger
        const onTouchMove = touchEvent => dragging && touchEvent.preventDefault();
        const end = () => {
            clearTimeout(timer);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', end);
            document.removeEventListener('pointercancel', end);
            document.removeEventListener('touchmove', onTouchMove);
            if (dragging) {
                chip.classList.remove('stqa_dragging');
                quietUntil = Date.now() + 400;
                onReorder([...chips.querySelectorAll('input')].map(input => input.dataset.floatingButton));
            }
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', end);
        document.addEventListener('pointercancel', end);
        document.addEventListener('touchmove', onTouchMove, { passive: false });
    });
}

/**
 * Translator: Google, or an AI. For the AI, the API (the one in use, or a saved connection
 * profile's) and the prompt are set apart: a profile lends only its API, never its preset.
 */
function translatorControls(settings) {
    const box = document.createElement('div');
    box.className = 'stqa_translator';
    const profiles = SillyTavern.getContext().extensionSettings.connectionManager?.profiles ?? [];
    const methods = [
        { value: 'google', label: '번역 방식: 구글 번역 (기본)' },
        { value: 'ai', label: '번역 방식: AI' },
    ];
    // Which API the AI translation goes to; the prompt below is chosen on its own
    const connections = [
        { value: '', label: 'AI 연결: 지금 쓰고 있는 API' },
        ...profiles.map(profile => ({ value: profile.id, label: `AI 연결: ${profile.name} (연결 프로필)` })),
    ];
    const ai = document.createElement('div');
    ai.className = 'stqa_translator_ai';
    const prompt = document.createElement('div');
    prompt.className = 'stqa_translator_prompt';
    prompt.innerHTML = '<small>번역 프롬프트: {{text}} 자리에 번역할 글이 들어갑니다.</small><textarea class="text_pole" rows="5"></textarea><div class="menu_button stqa_panel_button"><i class="fa-solid fa-rotate-left"></i><span>기본 프롬프트로 되돌리기</span></div>';
    const area = prompt.querySelector('textarea');
    area.value = settings.translatePrompt || DEFAULT_TRANSLATE_PROMPT;
    area.addEventListener('input', () => {
        settings.translatePrompt = area.value.trim() === DEFAULT_TRANSLATE_PROMPT ? '' : area.value;
        saveSettings();
    });
    prompt.querySelector('.menu_button').addEventListener('click', () => {
        area.value = DEFAULT_TRANSLATE_PROMPT;
        settings.translatePrompt = '';
        saveSettings();
    });
    ai.append(createInlineSelect({
        options: connections,
        // A profile deleted since: shown as the API in use
        value: connections.some(option => option.value === settings.translateProfile) ? settings.translateProfile : '',
        onChange: (value) => {
            settings.translateProfile = value;
            saveSettings();
        },
    }), prompt);
    ai.hidden = settings.translateEngine !== 'ai';
    box.append(createInlineSelect({
        options: methods,
        value: settings.translateEngine === 'ai' ? 'ai' : 'google',
        onChange: (value) => {
            settings.translateEngine = value;
            ai.hidden = value !== 'ai';
            saveSettings();
        },
    }), ai);
    return box;
}

/** Controls that belong to a feature: shown under it. */
function extrasFor(key) {
    const settings = getSettings();
    const extra = document.createDocumentFragment();
    const select = (options, value, onChange) => extra.append(createInlineSelect({ options, value, onChange }));
    if (key === 'selectionTools') {
        select(TOOLBAR_POSITIONS, settings.selectionToolbarPosition, (value) => {
            settings.selectionToolbarPosition = value;
            saveSettings();
        });
    } else if (key === 'footerSwipe' || key === 'footerTop') {
        const setting = key === 'footerSwipe' ? 'footerSwipePos' : 'footerTopPos';
        select(FOOTER_POSITIONS, settings[setting], (value) => {
            settings[setting] = value;
            saveSettings();
            applyMessageToolSettings();
        });
    } else if (key === 'emptyReplyDelete') {
        // 지우기만 / 다시 생성만 / 지우고 다시 생성, and for the last two: 다시 생성 [n]번
        const label = document.createElement('label');
        label.className = 'stqa_retry_count';
        label.innerHTML = '<i class="fa-solid fa-rotate-right"></i><input type="number" class="text_pole" inputmode="numeric"><span>번</span>';
        label.title = '다시 생성 횟수';
        const input = label.querySelector('input');
        const count = () => Math.min(MAX_RETRIES, Math.max(1, Math.floor(Number(settings.emptyReplyRetries)) || 1));
        Object.assign(input, { min: 1, max: MAX_RETRIES, step: 1, value: String(count()) });
        const showCount = mode => (label.hidden = mode === 'delete');
        select(EMPTY_REPLY_MODES, emptyReplyMode(), (value) => {
            settings.emptyReplyMode = value;
            // Generating again needs a number of times (at least once)
            if (value !== 'delete') {
                settings.emptyReplyRetries = count();
                input.value = String(settings.emptyReplyRetries);
            }
            showCount(value);
            saveSettings();
        });
        input.addEventListener('change', () => {
            settings.emptyReplyRetries = Math.min(MAX_RETRIES, Math.max(1, Math.floor(Number(input.value)) || 1));
            input.value = String(settings.emptyReplyRetries);
            saveSettings();
        });
        showCount(emptyReplyMode());
        extra.append(label);    } else if (key === 'entryTranslate') {
        // Where it works: each place a switch of its own
        const chips = document.createElement('div');
        chips.className = 'stqa_chips';
        for (const [setting, icon, label] of [['entryTranslatePrompts', 'fa-list-check', '프롬프트'], ['entryTranslateWorld', 'fa-book-atlas', '월드인포'], ['entryTranslateCharacter', 'fa-user', '캐릭터 설명']]) {
            const chip = document.createElement('label');
            chip.className = 'stqa_chip';
            chip.innerHTML = `<input type="checkbox" data-setting="${setting}"><i class="fa-solid ${icon}"></i><span>${label}</span>`;
            chip.querySelector('input').checked = settings[setting] !== false;
            chips.append(chip);
        }
        extra.append(chips, translatorControls(settings));
    } else if (key === 'qrBar') {
        select(QR_MODES, settings.qrMode, (value) => {
            settings.qrMode = value;
            saveSettings();
            applyQrPreset();
        });
    } else if (key === 'floatingPanel') {
        select(FLOATING_LAYOUTS, settings.floatingLayout, (value) => {
            settings.floatingLayout = value;
            saveSettings();
            applyFloatingSettings();
        });
        const chips = document.createElement('div');
        chips.className = 'stqa_chips';
        // Menu items' names and icons come from other extensions: set as text and classes, not markup
        const renderChips = () => {
            chips.replaceChildren(...orderedFloatingButtons().map(({ key: button, icon, label }) => {
                const chip = document.createElement('label');
                chip.className = 'stqa_chip';
                chip.title = label;
                chip.innerHTML = '<input type="checkbox"><i></i><span></span>';
                chip.querySelector('input').dataset.floatingButton = button;
                chip.querySelector('input').checked = settings.floatingButtons?.[button] !== false;
                chip.querySelector('i').className = /\bfa-(solid|regular|brands)\b/.test(icon) ? icon : `fa-solid ${icon}`;
                chip.querySelector('span').textContent = label;
                return chip;
            }));
        };
        renderChips();
        enableChipOrdering(chips, (keys) => {
            settings.floatingOrder = keys;
            saveSettings();
            applyFloatingSettings();
        });
        extra.append(chips, panelButton('fa-plus', '메뉴 항목 추가', async () => {
            if (await pickMenuItems()) {
                renderChips();
            }
        }));
    } else if (key === 'messageTrash') {
        // 30 choices: the device's own option popup rather than a list unfolding in the window
        const days = document.createElement('select');
        days.className = 'text_pole stqa_trash_days_select';
        for (let day = 1; day <= 30; day++) {
            days.append(new Option(`보관 기간: ${day}일`, String(day), false, day === settings.trashDays));
        }
        days.addEventListener('change', () => {
            settings.trashDays = Number(days.value);
            saveSettings();
        });
        const most = document.createElement('select');
        most.className = 'text_pole stqa_trash_days_select';
        for (const count of [0, 10, 20, 30, 50, 100, 200]) {
            most.append(new Option(count ? `최대 ${count}개` : '최대 개수: 제한 없음', String(count), false, count === (Number(settings.trashMax) || 0)));
        }
        most.addEventListener('change', async () => {
            const before = Number(settings.trashMax) || 0;
            const next = Number(most.value);
            // A lower most cuts trash already kept: asked first
            if (next && (!before || next < before)
                && !await SillyTavern.getContext().Popup.show.confirm('휴지통', paintPalette(Object.assign(document.createElement('div'), { textContent: `채팅마다 ${next}개를 넘는 것은 오래된 것부터 지금 지워집니다.` })).outerHTML)) {
                most.value = String(before);
                return;
            }
            settings.trashMax = next;
            saveSettings();
            purgeTrash();
        });
        extra.append(days, most);
    } else if (key === 'extensionLinks') {
        extra.append(panelButton('fa-list-check', '항목 고르기', async () => {
            // Icons picked there show on the shortcuts too
            if (await pickExtensionLinks()) {
                applyFloatingSettings();
            }
        }));
    } else if (key === 'layoutManager') {
        extra.append(panelButton('fa-list-check', '메뉴 정리 열기', openLayoutEditor));
    }
    return extra;
}

function buildPanel() {
    const settings = getSettings();
    const panel = document.createElement('div');
    panel.className = 'stqa_panel stqa_set stqa_palette';
    panel.innerHTML = `
        <div class="stqa_set_head">
            <div class="stqa_set_title"><span class="stqa_set_brand"><i class="fa-solid fa-toolbox"></i></span><h3>편의성 모음</h3></div>
            <div class="stqa_set_head_end">
                <div class="stqa_set_palette_btn" role="button" tabindex="0" title="설정창 색"><i class="fa-solid fa-palette"></i></div>
                <label class="stqa_set_switch stqa_set_master"><span>사용</span><input type="checkbox" data-setting="enabled"></label>
            </div>
            <div class="stqa_set_palettes" hidden></div>
        </div>
        <div class="stqa_panel_search"><i class="fa-solid fa-magnifying-glass"></i><input class="text_pole" type="search" placeholder="기능 찾기 (휴지통, QR, 번역…)"></div>
        <div class="stqa_set_body">
            <div class="stqa_set_nav"></div>
            <span class="stqa_set_nav_more stqa_set_nav_left" hidden><i class="fa-solid fa-chevron-left"></i></span>
            <span class="stqa_set_nav_more stqa_set_nav_right" hidden><i class="fa-solid fa-chevron-right"></i></span>
            <div class="stqa_set_content">
                <div class="stqa_set_content_head"><b class="stqa_set_heading"></b><span class="stqa_set_count"></span></div>
                <div class="stqa_set_list"></div>
            </div>
        </div>`;
    panel.querySelector('[data-setting="enabled"]').checked = settings.enabled !== false;

    // Colours: 🎨 opens the choice (the theme's own among them)
    const palette = () => (PALETTES.some(({ id }) => id === settings.settingsPalette) ? settings.settingsPalette : PALETTES[0].id);
    panel.dataset.palette = palette();
    const palettes = panel.querySelector('.stqa_set_palettes');
    for (const { id, name, dots } of PALETTES) {
        const choice = document.createElement('div');
        choice.className = 'stqa_set_palette';
        choice.setAttribute('role', 'button');
        choice.tabIndex = 0;
        choice.dataset.id = id;
        choice.innerHTML = '<span class="stqa_set_palette_dot"></span><small></small>';
        // The main colour (밤: its dark ground), ringed inside with the other where shadows are drawn
        Object.assign(choice.querySelector('.stqa_set_palette_dot').style, { background: dots[0], boxShadow: `inset 0 0 0 4px ${dots[1]}, 0 0 0 1px rgba(0, 0, 0, 0.14)` });
        choice.querySelector('small').textContent = name;
        palettes.append(choice);
    }
    const markPalette = () => palettes.querySelectorAll('.stqa_set_palette').forEach(choice => choice.classList.toggle('stqa_set_current', choice.dataset.id === palette()));
    markPalette();
    panel.querySelector('.stqa_set_palette_btn').addEventListener('click', () => (palettes.hidden = !palettes.hidden));
    palettes.addEventListener('click', (event) => {
        const choice = event.target.closest('.stqa_set_palette');
        if (!choice) {
            return;
        }
        settings.settingsPalette = choice.dataset.id;
        panel.dataset.palette = choice.dataset.id;
        markPalette();
        saveSettings();
        palettes.hidden = true;
    });
    // A tap elsewhere closes the choice
    panel.addEventListener('click', (event) => {
        if (!palettes.hidden && !event.target.closest('.stqa_set_palettes, .stqa_set_palette_btn')) {
            palettes.hidden = true;
        }
    });

    const nav = panel.querySelector('.stqa_set_nav');
    const list = panel.querySelector('.stqa_set_list');
    const heading = panel.querySelector('.stqa_set_heading');
    const count = panel.querySelector('.stqa_set_count');
    const search = panel.querySelector('.stqa_panel_search input');

    // Every row once, in category order under its group's name; a category shows its own
    const rows = [];
    const groups = [];
    for (const { title, groups: categoryGroups } of CATEGORIES) {
        for (const [groupTitle, items] of categoryGroups) {
            if (groupTitle) {
                const label = document.createElement('div');
                label.className = 'stqa_set_group';
                label.dataset.category = title;
                label.textContent = groupTitle;
                list.append(label);
                groups.push(label);
            }
            for (const item of items) {
                const row = featureRow(item, title);
                list.append(row);
                rows.push(row);
            }
        }
    }
    const empty = document.createElement('div');
    empty.className = 'stqa_set_empty';
    list.append(empty);

    // ☆ on a row puts it in 즐겨찾기 (★), and takes it out again
    const favorites = () => (Array.isArray(settings.settingsFavorites) ? settings.settingsFavorites : []);
    const syncStar = (row) => {
        const on = favorites().includes(row.dataset.id);
        const star = row.querySelector('.stqa_set_fav');
        star.classList.toggle('stqa_set_fav_on', on);
        star.querySelector('i').className = `${on ? 'fa-solid' : 'fa-regular'} fa-star`;
    };
    rows.forEach(syncStar);
    list.addEventListener('click', (event) => {
        const star = event.target.closest('.stqa_set_fav');
        if (!star) {
            return;
        }
        const row = star.closest('.stqa_set_row');
        const id = row.dataset.id;
        const rest = favorites().filter(item => item !== id);
        settings.settingsFavorites = rest.length === favorites().length ? [...rest, id] : rest;
        saveSettings();
        syncStar(row);
        // (Taken out while looking at 즐겨찾기: it stays until the page is shown again)
    });

    const NAV = [{ title: FAVORITES_TITLE, icon: 'fa-star' }, ...CATEGORIES];
    const navButtons = NAV.map(({ title, icon }) => {
        const button = document.createElement('div');
        button.className = 'stqa_set_navbtn';
        button.setAttribute('role', 'button');
        button.tabIndex = 0;
        button.dataset.category = title;
        button.innerHTML = `<i class="fa-solid ${icon}"></i><span></span><small></small>`;
        button.querySelector('span').textContent = title;
        button.addEventListener('click', () => {
            search.value = '';
            show(title);
        });
        nav.append(button);
        return button;
    });

    // On a phone the categories scroll sideways: the ends fade (with an arrow) while there are
    // more that way
    const moreLeft = panel.querySelector('.stqa_set_nav_left');
    const moreRight = panel.querySelector('.stqa_set_nav_right');
    const syncNavEnds = () => {
        const sideways = nav.scrollWidth > nav.clientWidth + 4 && getComputedStyle(nav).flexDirection !== 'column';
        const left = sideways && nav.scrollLeft > 4;
        const right = sideways && nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4;
        nav.classList.toggle('stqa_nav_fade_l', left);
        nav.classList.toggle('stqa_nav_fade_r', right);
        moreLeft.hidden = !left;
        moreRight.hidden = !right;
        moreLeft.style.height = moreRight.style.height = `${nav.offsetHeight}px`;
    };
    nav.addEventListener('scroll', syncNavEnds, { passive: true });
    new ResizeObserver(syncNavEnds).observe(nav);

    // Features, not rows (a row may hold several)
    const onCount = (title) => {
        const keys = new Set(rows.filter(row => row.dataset.category === title)
            .flatMap(row => [...row.querySelectorAll('input[data-setting]')].map(input => input.dataset.setting)));
        return `${[...keys].filter(key => settings[key] !== false).length}/${keys.size}`;
    };
    const updateCounts = () => {
        navButtons.forEach(button => (button.querySelector('small').textContent = button.dataset.category === FAVORITES_TITLE ? '' : onCount(button.dataset.category)));
        if (!search.value.trim() && current !== FAVORITES_TITLE) {
            count.textContent = `켜짐 ${onCount(current)}`;
        }
    };

    let current = FAVORITES_TITLE;
    const show = (title) => {
        current = title;
        clearFound();
        const starred = title === FAVORITES_TITLE;
        const picked = favorites();
        rows.forEach((row) => {
            const at = picked.indexOf(row.dataset.id);
            row.hidden = starred ? at === -1 : row.dataset.category !== title;
            row.style.order = starred && at !== -1 ? String(at) : '';
        });
        groups.forEach(group => (group.hidden = starred || group.dataset.category !== title));
        empty.textContent = '☆ 를 누른 기능이 여기 모입니다.';
        empty.hidden = !starred || rows.some(row => !row.hidden);
        heading.textContent = title;
        count.textContent = '';
        navButtons.forEach(button => button.classList.toggle('stqa_set_current', button.dataset.category === title));
        updateCounts();
        list.scrollTop = 0;
        navButtons.find(button => button.dataset.category === title)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    };

    // Searching: every category's matching rows, with the words marked. A match only in a
    // row's help opens it (closed again when the search is)
    const marks = typeof Highlight === 'function' && globalThis.CSS?.highlights ? CSS.highlights : null;
    const clearFound = () => {
        marks?.delete('stqa-found');
        rows.forEach((row) => {
            row.querySelectorAll('.stqa_set_chip').forEach(chip => chip.classList.remove('stqa_chip_found', 'stqa_chip_dim'));
            row.querySelectorAll('.stqa_set_part').forEach(part => (part.hidden = false));
            row.querySelector('.stqa_set_cat').hidden = true;
            if (row.dataset.autoHelp) {
                row.querySelector('.stqa_set_help').hidden = true;
                row.querySelector('.stqa_set_helpbtn').setAttribute('aria-expanded', 'false');
                delete row.dataset.autoHelp;
            }
        });
    };
    const markWords = (words) => {
        if (!marks) {
            return;
        }
        const ranges = [];
        for (const row of rows.filter(row => !row.hidden)) {
            const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const text = node.data.toLowerCase();
                // (A letter whose lower case is longer would put the marks off: such text isn't marked)
                if (text.length !== node.data.length) {
                    continue;
                }
                for (const word of words) {
                    for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + word.length)) {
                        const range = new Range();
                        range.setStart(node, at);
                        range.setEnd(node, at + word.length);
                        ranges.push(range);
                    }
                }
            }
        }
        marks.set('stqa-found', new Highlight(...ranges));
    };
    const find = () => {
        const raw = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (!raw.length) {
            show(current);
            return;
        }
        clearFound();
        const words = raw.map(searchable);
        let found = 0;
        rows.forEach((row) => {
            row.hidden = !words.every(word => row.dataset.search.includes(word));
            row.style.order = '';
            if (row.hidden) {
                return;
            }
            found++;
            const cat = row.querySelector('.stqa_set_cat');
            cat.textContent = row.dataset.category;
            cat.hidden = false;
            const help = row.querySelector('.stqa_set_help');
            // A row of several, found by some of its chips (not by its own name): those chips
            // stand out and only their help opens
            const parts = row.stqaPartSearch;
            const hits = parts && !words.every(word => row.stqaOwnSearch.includes(word))
                ? Object.keys(parts).filter(key => words.every(word => parts[key].includes(word))) : [];
            if (hits.length && hits.length < Object.keys(parts).length) {
                row.querySelectorAll('.stqa_set_chip').forEach((chip) => {
                    const hit = hits.includes(chip.dataset.key);
                    chip.classList.toggle('stqa_chip_found', hit);
                    chip.classList.toggle('stqa_chip_dim', !hit);
                });
                row.querySelectorAll('.stqa_set_part').forEach(part => (part.hidden = !hits.includes(part.dataset.key)));
                if (help.hidden) {
                    help.hidden = false;
                    row.querySelector('.stqa_set_helpbtn').setAttribute('aria-expanded', 'true');
                    row.dataset.autoHelp = '1';
                }
                return;
            }
            const outside = searchable([...row.querySelectorAll('.stqa_set_name, .stqa_set_sum, .stqa_set_chip span')].map(node => node.textContent).join(' '));
            if (help.hidden && !words.every(word => outside.includes(word))) {
                help.hidden = false;
                row.querySelector('.stqa_set_helpbtn').setAttribute('aria-expanded', 'true');
                row.dataset.autoHelp = '1';
            }
        });
        groups.forEach(group => (group.hidden = true));
        empty.textContent = '찾은 기능이 없습니다.';
        empty.hidden = found > 0;
        heading.textContent = '검색 결과';
        count.textContent = `${found}개`;
        navButtons.forEach(button => button.classList.remove('stqa_set_current'));
        list.scrollTop = 0;
        markWords(raw);
    };
    search.addEventListener('input', find);
    // Opens on 즐겨찾기 when something starred is still there, else on the first category
    show(favorites().some(id => rows.some(row => row.dataset.id === id)) ? FAVORITES_TITLE : CATEGORIES[0].title);

    // Enter and Space press what is shown as a button (도움말 handles its own)
    panel.addEventListener('keydown', (event) => {
        const button = event.target.closest?.('[role="button"]');
        if (!button || button.classList.contains('stqa_set_helpbtn') || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
        }
        event.preventDefault();
        button.click();
    });

    const syncMaster = () => panel.classList.toggle('stqa_set_all_off', settings.enabled === false);
    syncMaster();

    panel.addEventListener('change', (event) => {
        const target = event.target;
        if (target.dataset?.floatingButton) {
            settings.floatingButtons = { ...settings.floatingButtons, [target.dataset.floatingButton]: target.checked };
        } else if (target.dataset?.setting) {
            settings[target.dataset.setting] = target.checked;
            const row = target.closest('.stqa_set_row');
            row && syncRow(row);
            updateCounts();
        } else {
            return;
        }
        saveSettings();
        syncMaster();
        applyAll();
    });
    return panel;
}

let panelOpen = false;

async function openPanel() {
    // (Pressed twice: one window)
    if (panelOpen) {
        return;
    }
    panelOpen = true;
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    try {
        // Search and categories stay put; only the list of features scrolls
        await new Popup(buildPanel(), POPUP_TYPE.TEXT, '', { okButton: '닫기', leftAlign: true, wide: true }).show();
    } finally {
        panelOpen = false;
        // (The search's marks)
        globalThis.CSS?.highlights?.delete('stqa-found');
    }
}

function addMenuButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) {
        return;
    }
    const item = document.createElement('div');
    item.id = `${MODULE}_menu`;
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<div class="fa-solid fa-toolbox extensionsMenuExtensionButton"></div><span>편의성 모음</span>';
    item.addEventListener('click', openPanel);
    item.addEventListener('keydown', event => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), openPanel()));
    menu.append(item);
}

/** Starts one feature; one failing (an ST update changed what it needs) leaves the others running. */
function start(name, init) {
    try {
        const result = init();
        result?.catch?.(error => console.error(`[${MODULE}] ${name} failed`, error));
    } catch (error) {
        console.error(`[${MODULE}] ${name} failed`, error);
    }
}

(function init() {
    // First, before anything else can save a chat
    start('initSaveGuard', initSaveGuard);
    start('initErrorLog', initErrorLog);
    start('initVertexProfileFix', initVertexProfileFix);
    start('initPromptRenderFix', initPromptRenderFix);
    start('initDeleteButton', initDeleteButton);
    start('initChatPicker', initChatPicker);
    start('initNameOverride', initNameOverride);
    start('initSelectionTools', initSelectionTools);
    start('initMessageTools', initMessageTools);
    start('initQrBar', initQrBar);
    start('addMenuButton', addMenuButton);
    start('initLayoutManager', initLayoutManager);
    start('initFloatingPanel', initFloatingPanel);
    start('initQrInput', initQrInput);
    start('initStatusGuard', initStatusGuard);
    start('initDisplayTweaks', initDisplayTweaks);
    start('initFolders', initFolders);
    start('initPresetFolders', initPresetFolders);
    start('initToggleSets', initToggleSets);
    start('initRangeDelete', initRangeDelete);
    start('initCharListTools', initCharListTools);
    start('initChatExport', initChatExport);
    start('initChatName', initChatName);
    start('initChatReplace', initChatReplace);
    start('initChatSearch', initChatSearch);
    start('initChatSort', initChatSort);
    start('initMessageTrash', initMessageTrash);
    start('initEmptyReply', initEmptyReply);
    start('initPromptCopy', initPromptCopy);
    start('initSwipeList', initSwipeList);
    start('initBackupView', initBackupView);
    start('initExtensionLinks', initExtensionLinks);
    start('initWorldPicker', initWorldPicker);
    start('initPersonaTools', initPersonaTools);
    start('initKoFill', initKoFill);
    start('initEntryTranslate', initEntryTranslate);
})();
