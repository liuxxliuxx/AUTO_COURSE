import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ApplicationWindow {
    id: mainWindow

    width: 1120
    height: 700
    minimumWidth: 900
    minimumHeight: 580
    visible: true
    title: "智慧树自动刷课"
    flags: Qt.FramelessWindowHint | Qt.Window

    property int pageIndex: 0
    property int glassStrength: parseInt(bridge ? bridge.get_setting("bg_blur_radius") || "42" : "42")
    property string backgroundPath: bridge ? bridge.get_setting("bg_path") || "" : ""

    property QtObject theme: QtObject {
        readonly property color primary: "#3B82F6"
        readonly property color accent: "#16A085"
        readonly property color success: "#18A058"
        readonly property color danger: "#E5484D"
        readonly property color warning: "#B7791F"
        readonly property color info: "#2563EB"
        readonly property color textPrimary: "#172033"
        readonly property color textSecondary: "#5F6C7B"
        readonly property color textHint: "#8B96A5"
        readonly property color glassBg: "#DFFFFFFF"
        readonly property color glassBorder: "#8AFFFFFF"
        readonly property int radiusSm: 10
        readonly property int radiusMd: 16
        readonly property int radiusLg: 22
        readonly property int radiusXl: 28
        readonly property string fontFamily: "Microsoft YaHei UI"
        readonly property int fontSizeXs: 11
        readonly property int fontSizeSm: 12
        readonly property int fontSizeMd: 14
        readonly property int fontSizeLg: 18
        readonly property int fontSizeXl: 24
    }

    function localFileUrl(path) {
        if (!path)
            return ""
        var normalized = path.replace(/\\/g, "/")
        if (normalized.indexOf("file:/") === 0)
            return normalized
        return "file:///" + normalized
    }

    function toneColor(tone) {
        if (tone === "success")
            return theme.success
        if (tone === "danger")
            return theme.danger
        if (tone === "warning")
            return theme.warning
        if (tone === "info")
            return theme.info
        return theme.textHint
    }

    Item {
        anchors.fill: parent

        Rectangle {
            anchors.fill: parent
            gradient: Gradient {
                GradientStop { position: 0.0; color: "#F4F8FB" }
                GradientStop { position: 0.42; color: "#EFF4F1" }
                GradientStop { position: 1.0; color: "#F7F3EC" }
            }
        }

        Image {
            anchors.fill: parent
            source: mainWindow.localFileUrl(mainWindow.backgroundPath)
            visible: source !== ""
            fillMode: Image.PreserveAspectCrop
            opacity: 0.26
            asynchronous: true
        }

        Rectangle {
            width: parent.width * 1.25
            height: 150
            x: -parent.width * 0.13
            y: 88
            rotation: -7
            opacity: 0.34
            gradient: Gradient {
                GradientStop { position: 0.0; color: "#00FFFFFF" }
                GradientStop { position: 0.24; color: "#88DDEBFF" }
                GradientStop { position: 0.58; color: "#7FDDF7E8" }
                GradientStop { position: 1.0; color: "#00FFFFFF" }
            }

            SequentialAnimation on y {
                loops: Animation.Infinite
                NumberAnimation { from: 78; to: 112; duration: 9800; easing.type: Easing.InOutSine }
                NumberAnimation { from: 112; to: 78; duration: 9800; easing.type: Easing.InOutSine }
            }
        }

        Rectangle {
            width: parent.width * 1.18
            height: 132
            x: -parent.width * 0.04
            y: parent.height - 205
            rotation: 5
            opacity: 0.27
            gradient: Gradient {
                GradientStop { position: 0.0; color: "#00FFFFFF" }
                GradientStop { position: 0.34; color: "#80FFE6B5" }
                GradientStop { position: 0.72; color: "#77C7E7FF" }
                GradientStop { position: 1.0; color: "#00FFFFFF" }
            }

            SequentialAnimation on x {
                loops: Animation.Infinite
                NumberAnimation { from: -mainWindow.width * 0.06; to: mainWindow.width * 0.02; duration: 11800; easing.type: Easing.InOutSine }
                NumberAnimation { from: mainWindow.width * 0.02; to: -mainWindow.width * 0.06; duration: 11800; easing.type: Easing.InOutSine }
            }
        }

        Rectangle {
            anchors.fill: parent
            color: Qt.rgba(1, 1, 1, Math.min(0.34, Math.max(0.12, mainWindow.glassStrength / 300)))
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 54
            color: "#28FFFFFF"

            MouseArea {
                anchors.fill: parent
                property point last: Qt.point(0, 0)
                onPressed: last = Qt.point(mouseX, mouseY)
                onPositionChanged: {
                    mainWindow.x += mouseX - last.x
                    mainWindow.y += mouseY - last.y
                }
            }

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 18
                anchors.rightMargin: 10
                spacing: 10

                Rectangle {
                    Layout.preferredWidth: 32
                    Layout.preferredHeight: 32
                    radius: 11
                    color: "#E8FFFFFF"
                    border.width: 1
                    border.color: "#88FFFFFF"

                    Text {
                        anchors.centerIn: parent
                        text: "智"
                        color: theme.primary
                        font {
                            family: theme.fontFamily
                            pixelSize: 15
                            weight: Font.DemiBold
                        }
                    }
                }

                ColumnLayout {
                    spacing: 0

                    Text {
                        text: "智慧树自动刷课"
                        color: theme.textPrimary
                        font {
                            family: theme.fontFamily
                            pixelSize: 14
                            weight: Font.DemiBold
                        }
                    }

                    Text {
                        text: mainWindow.pageIndex === 0 ? "运行控制台" : "偏好设置"
                        color: theme.textHint
                        font {
                            family: theme.fontFamily
                            pixelSize: 10
                        }
                    }
                }

                Item { Layout.fillWidth: true }

                Button {
                    id: settingsButton
                    Layout.preferredWidth: 38
                    Layout.preferredHeight: 36
                    enabled: mainWindow.pageIndex === 0
                    text: "设置"
                    onClicked: mainWindow.pageIndex = 1
                    contentItem: Text {
                        text: settingsButton.text
                        color: settingsButton.enabled ? theme.textSecondary : "#A5AFBA"
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                        font {
                            family: theme.fontFamily
                            pixelSize: 12
                            weight: Font.Medium
                        }
                    }
                    background: Rectangle {
                        radius: 12
                        color: settingsButton.hovered && settingsButton.enabled ? "#DFFFFFFF" : "#00FFFFFF"
                        border.width: settingsButton.hovered && settingsButton.enabled ? 1 : 0
                        border.color: "#82FFFFFF"

                        Behavior on color { ColorAnimation { duration: 160 } }
                    }
                }

                Button {
                    id: minimizeButton
                    Layout.preferredWidth: 36
                    Layout.preferredHeight: 36
                    text: "-"
                    onClicked: mainWindow.showMinimized()
                    contentItem: Text {
                        text: minimizeButton.text
                        color: theme.textSecondary
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                        font.pixelSize: 18
                    }
                    background: Rectangle {
                        radius: 12
                        color: minimizeButton.hovered ? "#DFFFFFFF" : "#00FFFFFF"
                        Behavior on color { ColorAnimation { duration: 160 } }
                    }
                }

                Button {
                    id: closeButton
                    Layout.preferredWidth: 36
                    Layout.preferredHeight: 36
                    text: "x"
                    onClicked: mainWindow.close()
                    contentItem: Text {
                        text: closeButton.text
                        color: closeButton.hovered ? "#FFFFFF" : theme.textSecondary
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                        font.pixelSize: 14
                    }
                    background: Rectangle {
                        radius: 12
                        color: closeButton.hovered ? theme.danger : "#00FFFFFF"
                        Behavior on color { ColorAnimation { duration: 160 } }
                    }
                }
            }
        }

        Item {
            id: pageHost
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true

            MainPage {
                id: mainPageItem
                theme: mainWindow.theme
                width: parent.width
                height: parent.height
                visible: mainWindow.pageIndex === 0 || opacity > 0.01
                opacity: mainWindow.pageIndex === 0 ? 1 : 0
                x: mainWindow.pageIndex === 0 ? 0 : -26
                enabled: mainWindow.pageIndex === 0

                onStartStopClicked: bridge.toggle_running()
                onBrushToggled: function(checked) { bridge.save_setting("brush_enabled", checked ? "1" : "0") }
                onTranscribeToggled: function(checked) { bridge.save_setting("transcribe_enabled", checked ? "1" : "0") }
                onCourseSelected: function(url, note) { bridge.course_selected(url, note) }
                onCaptchaConfirmClicked: bridge.confirm_captcha()

                Behavior on opacity {
                    NumberAnimation { duration: 260; easing.type: Easing.OutCubic }
                }
                Behavior on x {
                    NumberAnimation { duration: 320; easing.type: Easing.OutCubic }
                }
            }

            SettingsPage {
                id: settingsPageItem
                theme: mainWindow.theme
                width: parent.width
                height: parent.height
                visible: mainWindow.pageIndex === 1 || opacity > 0.01
                opacity: mainWindow.pageIndex === 1 ? 1 : 0
                x: mainWindow.pageIndex === 1 ? 0 : 26
                enabled: mainWindow.pageIndex === 1
                onBackClicked: mainWindow.pageIndex = 0

                Behavior on opacity {
                    NumberAnimation { duration: 260; easing.type: Easing.OutCubic }
                }
                Behavior on x {
                    NumberAnimation { duration: 320; easing.type: Easing.OutCubic }
                }
            }
        }
    }

    Connections {
        target: bridge

        function onLogReceived(line) {
            mainPageItem.appendLog(line)
        }

        function onStatusChanged(text, tone) {
            mainPageItem.setStatus(text, mainWindow.toneColor(tone))
        }

        function onBotStarted(mode) {
            mainPageItem.setRunning(true)
            var label = mode === "仅转录" ? "● 仅转录中" : "● 正在刷课"
            mainPageItem.setStatus(label, mainWindow.theme.success)
        }

        function onBotStopped(label) {
            mainPageItem.setRunning(false)
            mainPageItem.setStatus("● " + label, mainWindow.theme.textHint)
            mainPageItem.hideCaptcha()
        }

        function onTranscribeStatusChanged(status) {
            var color = {
                "green": mainWindow.theme.success,
                "red": mainWindow.theme.danger,
                "blue": mainWindow.theme.info,
                "orange": mainWindow.theme.warning
            }[status.color] || mainWindow.theme.textHint
            mainPageItem.setStatus(status.text, color)
        }

        function onCaptchaDetected(hint) {
            mainPageItem.showCaptcha(hint)
            mainPageItem.setStatus("⚠ " + hint, mainWindow.theme.warning)
        }

        function onCaptchaCleared() {
            mainPageItem.hideCaptcha()
            mainPageItem.setStatus("● 等待继续", mainWindow.theme.success)
        }

        function onCoursesLoaded(items) {
            mainPageItem.loadCourses(items)
        }
    }
}
