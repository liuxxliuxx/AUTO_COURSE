import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    anchors.fill: parent
    anchors.margins: 22

    property var theme

    signal backClicked()

    ColumnLayout {
        anchors.fill: parent
        spacing: 16

        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 42
            spacing: 12

            Button {
                id: backButton
                Layout.preferredWidth: 74
                Layout.preferredHeight: 42
                text: "返回"
                onClicked: root.backClicked()

                contentItem: Text {
                    text: backButton.text
                    color: backButton.hovered ? "#FFFFFF" : "#2E5AA7"
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                    font {
                        family: "Microsoft YaHei UI"
                        pixelSize: 13
                        weight: Font.DemiBold
                    }
                }

                background: Rectangle {
                    radius: 14
                    color: backButton.hovered ? "#5B8DEF" : "#C8FFFFFF"
                    border.width: 1
                    border.color: "#80FFFFFF"

                    Behavior on color {
                        ColorAnimation { duration: 150 }
                    }
                }
            }

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 0

                Text {
                    Layout.fillWidth: true
                    text: "设置"
                    color: theme ? theme.textPrimary : "#1F2A37"
                    elide: Text.ElideRight
                    font {
                        family: "Microsoft YaHei UI"
                        pixelSize: 23
                        weight: Font.DemiBold
                    }
                }

                Text {
                    Layout.fillWidth: true
                    text: nav.currentItem ? nav.currentItem.sectionName : "账号"
                    color: theme ? theme.textSecondary : "#657286"
                    elide: Text.ElideRight
                    font {
                        family: "Microsoft YaHei UI"
                        pixelSize: 12
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 18

            GlassPanel {
                Layout.preferredWidth: 186
                Layout.fillHeight: true
                cornerRadius: 24
                glassOpacity: 0.62
                tintColor: "#D4FFFFFF"

                ListView {
                    id: nav
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 6
                    clip: true
                    currentIndex: 0
                    model: ListModel {
                        ListElement { name: "账号"; mark: "01" }
                        ListElement { name: "课程"; mark: "02" }
                        ListElement { name: "浏览器"; mark: "03" }
                        ListElement { name: "语音转文字"; mark: "04" }
                        ListElement { name: "自动调度"; mark: "05" }
                        ListElement { name: "外观"; mark: "06" }
                    }

                    delegate: ItemDelegate {
                        id: navItem
                        width: ListView.view.width
                        height: 46
                        highlighted: ListView.isCurrentItem
                        property string sectionName: name

                        onClicked: {
                            nav.currentIndex = index
                            stack.currentIndex = index
                        }

                        contentItem: RowLayout {
                            spacing: 10

                            Text {
                                text: mark
                                color: navItem.highlighted ? "#2E5AA7" : "#7D8795"
                                font {
                                    family: "Segoe UI"
                                    pixelSize: 11
                                    weight: Font.Bold
                                    letterSpacing: 0
                                }
                            }

                            Text {
                                Layout.fillWidth: true
                                text: name
                                color: navItem.highlighted ? "#1F2A37" : "#526071"
                                elide: Text.ElideRight
                                font {
                                    family: "Microsoft YaHei UI"
                                    pixelSize: 13
                                    weight: navItem.highlighted ? Font.DemiBold : Font.Normal
                                }
                            }
                        }

                        background: Rectangle {
                            radius: 14
                            color: navItem.highlighted ? "#E6FFFFFF" : (navItem.hovered ? "#70FFFFFF" : "transparent")
                            border.width: navItem.highlighted ? 1 : 0
                            border.color: "#86FFFFFF"

                            Rectangle {
                                width: 3
                                height: parent.height - 18
                                radius: 2
                                anchors.left: parent.left
                                anchors.leftMargin: 6
                                anchors.verticalCenter: parent.verticalCenter
                                color: "#5B8DEF"
                                visible: navItem.highlighted
                            }
                        }
                    }
                }
            }

            GlassPanel {
                Layout.fillWidth: true
                Layout.fillHeight: true
                cornerRadius: 24
                glassOpacity: 0.66
                tintColor: "#DCFFFFFF"

                StackLayout {
                    id: stack
                    anchors.fill: parent
                    anchors.margins: 28
                    currentIndex: 0

                    SettingsForm {
                        theme: root.theme
                        title: "账号设置"
                        model: [
                            { label: "用户名", key: "username", type: "text" },
                            { label: "密码", key: "password", type: "password" },
                            { label: "登录方式", key: "login_method", type: "combo", values: ["智慧树", "数字石大"] },
                            { label: "登录跳转 URL", key: "logged_url", type: "text" }
                        ]
                    }

                    SettingsForm {
                        theme: root.theme
                        title: "课程设置"
                        model: [
                            { label: "课程视频 URL", key: "video_url", type: "text" },
                            { label: "课程备注", key: "course_note", type: "text" },
                            { label: "刷课时长(分钟, 0=不限)", key: "time_limit", type: "text" },
                            { label: "跳过已学课程", key: "skip_completed", type: "check" },
                            { label: "从上次进度开始", key: "from_last_progress", type: "check" }
                        ]
                    }

                    BrowserSettingsForm {
                        theme: root.theme
                    }

                    SettingsForm {
                        theme: root.theme
                        title: "语音转文字设置"
                        model: [
                            { label: "启用语音转文字", key: "transcribe_enabled", type: "check" },
                            { label: "保存路径", key: "transcribe_base_dir", type: "browse" }
                        ]
                    }

                    SettingsForm {
                        theme: root.theme
                        title: "自动调度设置"
                        model: [
                            { label: "启用自动刷课", key: "auto_mode", type: "check" },
                            { label: "开始时间", key: "auto_start_time", type: "text" },
                            { label: "结束时间", key: "auto_end_time", type: "text" },
                            { label: "全天运行", key: "auto_allday", type: "check" },
                            { label: "每日目标(分钟)", key: "auto_limit", type: "text" }
                        ]
                    }

                    SettingsForm {
                        theme: root.theme
                        title: "外观设置"
                        model: [
                            { label: "背景图片路径", key: "bg_path", type: "file", fileKind: "image" },
                            { label: "玻璃强度", key: "bg_blur_radius", type: "slider", from: 10, to: 80 }
                        ]
                    }
                }
            }
        }
    }
}
